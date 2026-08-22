import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Merchant, PaymentSession } from "../../drizzle/schema";
import { getMerchantsByUserId } from "../db";
import { logger } from "../lib/logger";
import { recordPaymentRoute } from "../observability/metrics";
import {
  authorizationHeaders,
  getTraceContext,
  traceHeaders,
} from "../middleware/trace-context";
import {
  getPaymentRepository,
  PaymentIdempotencyConflictError,
  PaymentRepository,
  PaymentRepositoryUnavailableError,
  PaymentSessionNotFoundError,
  PaymentStateConflictError,
} from "../repositories/paymentRepository";
import {
  authenticateKeycloakPrincipal,
  type KeycloakPrincipal,
} from "../security/keycloakAuth";
import {
  evaluatePbac,
  OpaUnavailableError,
  type PbacInput,
} from "../security/opaClient";
import {
  PermifyDeniedError,
  PermifyUnavailableError,
  requireResourcePermission,
  writePermifyRelationship,
  type PermifyPermissionInput,
  type PermifyRelationshipInput,
} from "../security/permifyAuth";

const paymentInput = z
  .object({
    amount: z.number().int().positive().max(99_999_999_999),
    currency: z
      .string()
      .regex(/^[A-Za-z]{3}$/)
      .transform(value => value.toUpperCase()),
    sourceAccount: z.string().trim().min(1).max(100),
    beneficiaryAccount: z.string().trim().min(1).max(100),
    transferId: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(500).optional(),
    requiresApproval: z.boolean().default(false),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(value => value.sourceAccount !== value.beneficiaryAccount, {
    message: "sourceAccount and beneficiaryAccount must be different",
    path: ["beneficiaryAccount"],
  });

export type PaymentCommand = z.infer<typeof paymentInput>;

export class PaymentOrchestratorUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Payment workflow orchestrator is unavailable");
    this.name = "PaymentOrchestratorUnavailableError";
    this.cause = cause;
  }
  cause?: unknown;
}

export interface PaymentWorkflowResult {
  workflowId: string;
  transactionId: string;
  status: string;
}

export interface PaymentRestRepository {
  findBySessionId(sessionId: string): Promise<PaymentSession | undefined>;
  admitIdempotent(
    input: Parameters<PaymentRepository["admitIdempotent"]>[0]
  ): ReturnType<PaymentRepository["admitIdempotent"]>;
  setWorkflowForTenant(
    tenantId: string,
    sessionId: string,
    workflowId: string
  ): Promise<PaymentSession>;
  failAdmissionForTenant(tenantId: string, sessionId: string): Promise<void>;
  approveForTenant(
    tenantId: string,
    sessionId: string,
    subject: string
  ): ReturnType<PaymentRepository["approveForTenant"]>;
}

export interface PaymentRestDependencies {
  authenticate(request: Request): Promise<KeycloakPrincipal | null>;
  getRepository(): Promise<PaymentRestRepository>;
  getMerchants(userId: number): Promise<Merchant[]>;
  evaluatePolicy(input: PbacInput): Promise<boolean>;
  requirePermission(input: PermifyPermissionInput): Promise<void>;
  writeRelationship(input: PermifyRelationshipInput): Promise<void>;
  submitWorkflow(
    payment: PaymentSession,
    command: PaymentCommand,
    headers: Record<string, string>
  ): Promise<PaymentWorkflowResult>;
  generatePaymentId(): string;
  now(): Date;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestHash(command: PaymentCommand): string {
  return crypto.createHash("sha256").update(stableJson(command)).digest("hex");
}

function validIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,255}$/.test(value);
}

function commandFromPayment(payment: PaymentSession): PaymentCommand {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = payment.metadata
      ? (JSON.parse(payment.metadata) as Record<string, unknown>)
      : {};
  } catch {
    throw new Error("Stored payment metadata is invalid");
  }
  return paymentInput.parse({
    amount: payment.amount,
    currency: payment.currency,
    sourceAccount: metadata.sourceAccount,
    beneficiaryAccount: metadata.beneficiaryAccount,
    transferId: metadata.transferId,
    description: payment.description ?? undefined,
    requiresApproval: true,
    metadata: metadata.metadata,
  });
}

function paymentView(payment: PaymentSession) {
  return {
    paymentId: payment.sessionId,
    transactionId: payment.sessionId,
    workflowId: payment.workflowId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    approvedAt: payment.approvedAt,
  };
}

async function defaultSubmitWorkflow(
  payment: PaymentSession,
  command: PaymentCommand,
  propagationHeaders: Record<string, string>
): Promise<PaymentWorkflowResult> {
  const endpoint = process.env.PAYMENT_ORCHESTRATOR_URL?.trim();
  const required = process.env.PAYMENT_ORCHESTRATOR_REQUIRED !== "false";
  if (!endpoint) {
    if (required)
      throw new PaymentOrchestratorUnavailableError(
        "PAYMENT_ORCHESTRATOR_URL is missing; payment execution is disabled"
      );
    throw new PaymentOrchestratorUnavailableError(
      "Payment orchestrator is not configured"
    );
  }
  try {
    const response = await fetch(
      `${endpoint.replace(/\/$/, "")}/api/v1/payments/initiate`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": payment.sessionId,
          ...propagationHeaders,
        },
        body: JSON.stringify({
          source: { type: "ACCOUNT", identifier: command.sourceAccount },
          destination: {
            type: "ACCOUNT",
            identifier: command.beneficiaryAccount,
          },
          amount: {
            currency: command.currency,
            value: (command.amount / 100).toFixed(2),
          },
          transactionType: "B2B",
          channel: "API",
          reference: command.transferId ?? payment.sessionId,
          description: command.description,
          metadata: {
            ...(command.metadata ?? {}),
            admittedPaymentId: payment.sessionId,
            tenantId: payment.tenantId,
            amountMinor: command.amount,
          },
        }),
        signal: AbortSignal.timeout(5_000),
      }
    );
    if (!response.ok)
      throw new Error(`payment orchestrator returned HTTP ${response.status}`);
    const result = (await response.json()) as {
      workflowId?: unknown;
      transactionId?: unknown;
      status?: unknown;
    };
    if (
      typeof result.workflowId !== "string" ||
      typeof result.transactionId !== "string"
    ) {
      throw new Error(
        "payment orchestrator response omitted workflow identifiers"
      );
    }
    return {
      workflowId: result.workflowId,
      transactionId: result.transactionId,
      status: typeof result.status === "string" ? result.status : "PROCESSING",
    };
  } catch (error) {
    if (error instanceof PaymentOrchestratorUnavailableError) throw error;
    throw new PaymentOrchestratorUnavailableError(error);
  }
}

const defaultDependencies: PaymentRestDependencies = {
  authenticate: authenticateKeycloakPrincipal,
  getRepository: getPaymentRepository,
  getMerchants: getMerchantsByUserId,
  evaluatePolicy: evaluatePbac,
  requirePermission: requireResourcePermission,
  writeRelationship: writePermifyRelationship,
  submitWorkflow: defaultSubmitWorkflow,
  generatePaymentId: () => `pay_${crypto.randomBytes(16).toString("hex")}`,
  now: () => new Date(),
};

function decisionId(response: Response, action: string): string {
  const context = getTraceContext(response);
  return `${action}:${context.traceId}`;
}

type PaymentOperation = "create" | "read" | "approve";

function observePaymentRoute(
  response: Response,
  operation: PaymentOperation
): void {
  const started = performance.now();
  response.once("finish", () => {
    const status = response.statusCode;
    const outcome =
      status >= 200 && status < 300
        ? "success"
        : status === 401 || status === 403
          ? "denied"
          : status >= 400 && status < 500
            ? "client_error"
            : status === 503
              ? "dependency_error"
              : "server_error";
    recordPaymentRoute(operation, outcome, (performance.now() - started) / 1000);
  });
}

function setDecisionHeaders(response: Response, action: string): void {
  const context = getTraceContext(response);
  const values = authorizationHeaders(context, decisionId(response, action));
  for (const [name, value] of Object.entries(values))
    response.setHeader(name, value);
}

async function requirePrincipal(
  request: Request,
  response: Response,
  dependencies: PaymentRestDependencies
): Promise<KeycloakPrincipal | undefined> {
  let principal: KeycloakPrincipal | null;
  try {
    principal = await dependencies.authenticate(request);
  } catch (error) {
    logger.warn(
      { err: error },
      "Keycloak bearer authentication rejected payment request"
    );
    response.status(401).json({ error: "INVALID_BEARER_TOKEN" });
    return;
  }
  if (!principal) {
    response.status(401).json({ error: "BEARER_AUTHENTICATION_REQUIRED" });
    return;
  }
  if (!principal.tenantId) {
    response.status(403).json({ error: "VERIFIED_TENANT_CLAIM_REQUIRED" });
    return;
  }
  const claimedTenant = request.header("x-tenant-id")?.trim();
  if (claimedTenant && claimedTenant !== principal.tenantId) {
    response.status(403).json({ error: "TENANT_HEADER_MISMATCH" });
    return;
  }
  return principal;
}

async function authorize(
  response: Response,
  dependencies: PaymentRestDependencies,
  principal: KeycloakPrincipal,
  action: string,
  resourceType: string,
  resourceId: string,
  resourceTenant: string,
  permissionEntityType: string,
  permissionEntityId: string,
  permission: string,
  source: "api" | "admin"
): Promise<boolean> {
  try {
    const allowed = await dependencies.evaluatePolicy({
      subject: {
        id: principal.subject,
        roles: principal.roles,
        tenantId: principal.tenantId,
        tenant_id: principal.tenantId,
        mfa_verified: principal.mfaVerified,
      },
      action,
      resource: {
        type: resourceType,
        id: resourceId,
        tenantId: resourceTenant,
        tenant_id: resourceTenant,
      },
      tenantId: principal.tenantId,
      source,
    });
    if (!allowed) {
      setDecisionHeaders(response, action);
      response.status(403).json({ allowed: false, error: "POLICY_DENIED" });
      return false;
    }
    await dependencies.requirePermission({
      entityType: permissionEntityType,
      entityId: permissionEntityId,
      permission,
      subjectId: principal.subject,
    });
    setDecisionHeaders(response, action);
    return true;
  } catch (error) {
    setDecisionHeaders(response, action);
    if (error instanceof PermifyDeniedError) {
      response
        .status(403)
        .json({ allowed: false, error: "RELATIONSHIP_DENIED" });
      return false;
    }
    if (
      error instanceof OpaUnavailableError ||
      error instanceof PermifyUnavailableError
    ) {
      response.status(503).json({
        allowed: false,
        error: "AUTHORIZATION_DEPENDENCY_UNAVAILABLE",
      });
      return false;
    }
    throw error;
  }
}

export function createPaymentRestRouter(
  dependencies: PaymentRestDependencies = defaultDependencies
): Router {
  const router = Router();

  router.get("/api/v1/payments/:paymentId", async (request, response) => {
    observePaymentRoute(response, "read");
    try {
      const principal = await requirePrincipal(request, response, dependencies);
      if (!principal) return;
      const repository = await dependencies.getRepository();
      const payment = await repository.findBySessionId(
        request.params.paymentId
      );
      if (!payment) {
        response.status(404).json({ error: "PAYMENT_NOT_FOUND" });
        return;
      }
      if (!payment.tenantId || payment.tenantId !== principal.tenantId) {
        setDecisionHeaders(response, "read");
        response
          .status(403)
          .json({ allowed: false, error: "CROSS_TENANT_ACCESS_DENIED" });
        return;
      }
      if (
        !(await authorize(
          response,
          dependencies,
          principal,
          "read",
          "payment",
          payment.sessionId,
          payment.tenantId,
          "payment",
          payment.sessionId,
          "read",
          "api"
        ))
      )
        return;
      response.status(200).json({ payment: paymentView(payment) });
    } catch (error) {
      handleRouteError(error, response);
    }
  });

  router.post("/api/v1/payments", async (request, response) => {
    observePaymentRoute(response, "create");
    try {
      const principal = await requirePrincipal(request, response, dependencies);
      if (!principal) return;
      const parsed = paymentInput.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({
          error: "INVALID_PAYMENT_COMMAND",
          issues: parsed.error.issues,
        });
        return;
      }
      const key = request.header("idempotency-key")?.trim() ?? "";
      if (!validIdempotencyKey(key)) {
        response.status(400).json({ error: "VALID_IDEMPOTENCY_KEY_REQUIRED" });
        return;
      }
      const merchants = await dependencies.getMerchants(principal.user.id);
      const merchant = merchants.find(
        candidate =>
          candidate.status === "active" &&
          candidate.tenantId === principal.tenantId
      );
      if (!merchant) {
        response.status(403).json({ error: "ACTIVE_TENANT_MERCHANT_REQUIRED" });
        return;
      }
      const provisionalId = dependencies.generatePaymentId();
      if (
        !(await authorize(
          response,
          dependencies,
          principal,
          "write",
          "payment",
          provisionalId,
          principal.tenantId,
          "merchant",
          String(merchant.id),
          "write",
          "api"
        ))
      )
        return;

      const repository = await dependencies.getRepository();
      const command = parsed.data;
      const admitted = await repository.admitIdempotent({
        sessionId: provisionalId,
        merchantId: merchant.id,
        tenantId: principal.tenantId,
        idempotencyKey: key,
        requestHash: requestHash(command),
        amount: command.amount,
        currency: command.currency,
        description: command.description ?? null,
        status: "pending",
        paymentMethod: "bank_transfer",
        metadata: JSON.stringify({
          sourceAccount: command.sourceAccount,
          beneficiaryAccount: command.beneficiaryAccount,
          transferId: command.transferId,
          requiresApproval: command.requiresApproval,
          metadata: command.metadata ?? {},
        }),
        expiresAt: new Date(dependencies.now().getTime() + 30 * 60 * 1000),
      });

      let payment = admitted.payment;
      await dependencies.writeRelationship({
        entityType: "payment",
        entityId: payment.sessionId,
        relation: "merchant",
        subjectType: "merchant",
        subjectId: String(merchant.id),
      });
      if (!command.requiresApproval && !payment.workflowId) {
        try {
          const workflow = await dependencies.submitWorkflow(
            payment,
            command,
            traceHeaders(getTraceContext(response))
          );
          payment = await repository.setWorkflowForTenant(
            principal.tenantId,
            payment.sessionId,
            workflow.workflowId
          );
        } catch (error) {
          await repository.failAdmissionForTenant(
            principal.tenantId,
            payment.sessionId
          );
          throw error;
        }
      }

      response.status(admitted.created ? 202 : 200).json({
        ...paymentView(payment),
        idempotencyReplayed: !admitted.created,
      });
    } catch (error) {
      handleRouteError(error, response);
    }
  });

  router.post(
    "/api/v1/admin/payments/:paymentId/approve",
    async (request, response) => {
      observePaymentRoute(response, "approve");
      try {
        const principal = await requirePrincipal(
          request,
          response,
          dependencies
        );
        if (!principal) return;
        if (!principal.mfaVerified) {
          setDecisionHeaders(response, "approve_payment");
          response
            .status(403)
            .json({ allowed: false, error: "VERIFIED_MFA_REQUIRED" });
          return;
        }
        const repository = await dependencies.getRepository();
        const payment = await repository.findBySessionId(
          request.params.paymentId
        );
        if (!payment) {
          response.status(404).json({ error: "PAYMENT_NOT_FOUND" });
          return;
        }
        if (!payment.tenantId || payment.tenantId !== principal.tenantId) {
          setDecisionHeaders(response, "approve_payment");
          response
            .status(403)
            .json({ allowed: false, error: "CROSS_TENANT_ACCESS_DENIED" });
          return;
        }
        if (
          !(await authorize(
            response,
            dependencies,
            principal,
            "approve_payment",
            "payment",
            payment.sessionId,
            payment.tenantId,
            "payment",
            payment.sessionId,
            "approve",
            "admin"
          ))
        )
          return;
        const approval = await repository.approveForTenant(
          principal.tenantId,
          payment.sessionId,
          principal.subject
        );
        let approved = approval.payment;
        if (!approved.workflowId) {
          try {
            const workflow = await dependencies.submitWorkflow(
              approved,
              commandFromPayment(approved),
              traceHeaders(getTraceContext(response))
            );
            approved = await repository.setWorkflowForTenant(
              principal.tenantId,
              approved.sessionId,
              workflow.workflowId
            );
          } catch (error) {
            await repository.failAdmissionForTenant(
              principal.tenantId,
              approved.sessionId
            );
            throw error;
          }
        }
        response.status(200).json({
          payment: paymentView(approved),
          decision: "approved",
          idempotencyReplayed: !approval.transitioned,
        });
      } catch (error) {
        handleRouteError(error, response);
      }
    }
  );

  return router;
}

function handleRouteError(error: unknown, response: Response): void {
  logger.warn({ err: error }, "Payment REST route failed closed");
  if (response.headersSent) return;
  if (
    error instanceof PaymentIdempotencyConflictError ||
    error instanceof PaymentStateConflictError
  ) {
    response.status(409).json({ error: error.name, message: error.message });
    return;
  }
  if (error instanceof PaymentSessionNotFoundError) {
    response.status(404).json({ error: "PAYMENT_NOT_FOUND" });
    return;
  }
  if (
    error instanceof OpaUnavailableError ||
    error instanceof PermifyUnavailableError ||
    error instanceof PaymentRepositoryUnavailableError ||
    error instanceof PaymentOrchestratorUnavailableError
  ) {
    response.status(503).json({ error: "REQUIRED_DEPENDENCY_UNAVAILABLE" });
    return;
  }
  response.status(500).json({ error: "PAYMENT_REQUEST_FAILED" });
}
