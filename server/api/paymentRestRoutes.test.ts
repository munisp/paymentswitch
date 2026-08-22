import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import type { Merchant, PaymentSession, User } from "../../drizzle/schema";
import { traceContextMiddleware } from "../middleware/trace-context";
import {
  createPaymentRestRouter,
  PaymentOrchestratorUnavailableError,
  type PaymentRestDependencies,
  type PaymentRestRepository,
} from "./paymentRestRoutes";
import type { KeycloakPrincipal } from "../security/keycloakAuth";
import { PaymentIdempotencyConflictError } from "../repositories/paymentRepository";
import { PermifyUnavailableError } from "../security/permifyAuth";

function principal(
  overrides: Partial<KeycloakPrincipal> = {}
): KeycloakPrincipal {
  return {
    user: { id: 41, sub: "subject-a", role: "merchant" } as User,
    subject: "subject-a",
    tenantId: "tenant-a",
    roles: ["merchant"],
    mfaVerified: false,
    claims: {},
    ...overrides,
  };
}

function merchant(overrides: Partial<Merchant> = {}): Merchant {
  return {
    id: 7,
    userId: 41,
    tenantId: "tenant-a",
    status: "active",
    businessName: "Tenant A Merchant",
  } as Merchant & typeof overrides;
}

function payment(overrides: Partial<PaymentSession> = {}): PaymentSession {
  const now = new Date("2026-08-21T12:00:00Z");
  return {
    id: 1,
    sessionId: "pay-a",
    merchantId: 7,
    tenantId: "tenant-a",
    idempotencyKey: "idem-a",
    requestHash: "a".repeat(64),
    workflowId: null,
    amount: 1000,
    currency: "NGN",
    description: null,
    customerEmail: null,
    customerName: null,
    customerPhone: null,
    merchantReference: null,
    successUrl: null,
    cancelUrl: null,
    status: "pending",
    paymentMethod: "bank_transfer",
    metadata: JSON.stringify({
      sourceAccount: "source-a",
      beneficiaryAccount: "beneficiary-a",
      requiresApproval: true,
      metadata: {},
    }),
    expiresAt: new Date("2026-08-22T12:00:00Z"),
    approvedAt: null,
    approvedBySubject: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function repository(initial = payment()): PaymentRestRepository & {
  state: PaymentSession;
} {
  const value: PaymentRestRepository & { state: PaymentSession } = {
    state: initial,
    async findBySessionId(sessionId) {
      return value.state.sessionId === sessionId ? value.state : undefined;
    },
    async admitIdempotent(input) {
      value.state = { ...value.state, ...input } as PaymentSession;
      return { payment: value.state, created: true };
    },
    async claimWorkflowDispatch() {
      if (value.state.status !== "pending") {
        return { payment: value.state, claimed: false };
      }
      value.state = { ...value.state, status: "processing" };
      return { payment: value.state, claimed: true };
    },
    async setWorkflowForTenant(_tenantId, _sessionId, workflowId) {
      value.state = { ...value.state, workflowId, status: "processing" };
      return value.state;
    },
    async markReconciliationRequiredForTenant() {
      value.state = { ...value.state, status: "reconciliation_required" };
    },
    async failAdmissionForTenant() {
      value.state = { ...value.state, status: "failed" };
    },
    async approveForTenant(_tenantId, _sessionId, subject) {
      value.state = {
        ...value.state,
        status: "processing",
        approvedAt: new Date("2026-08-21T12:01:00Z"),
        approvedBySubject: subject,
      };
      return { payment: value.state, transitioned: true };
    },
  };
  return value;
}

function dependencies(
  overrides: Partial<PaymentRestDependencies> = {}
): PaymentRestDependencies & { repo: ReturnType<typeof repository> } {
  const repo = repository();
  return {
    repo,
    authenticate: vi.fn(async () => principal()),
    getRepository: vi.fn(async () => repo),
    getMerchants: vi.fn(async () => [merchant()]),
    evaluatePolicy: vi.fn(async () => true),
    requirePermission: vi.fn(async () => undefined),
    writeRelationship: vi.fn(async () => undefined),
    submitWorkflow: vi.fn(async current => ({
      workflowId: `workflow-${current.sessionId}`,
      transactionId: current.sessionId,
      status: "PROCESSING",
    })),
    generatePaymentId: vi.fn(() => "pay-created"),
    now: vi.fn(() => new Date("2026-08-21T12:00:00Z")),
    ...overrides,
  };
}

function app(deps: PaymentRestDependencies) {
  const instance = express();
  instance.use(express.json());
  instance.use(traceContextMiddleware);
  instance.use(createPaymentRestRouter(deps));
  return instance;
}

const validCommand = {
  amount: 1000,
  currency: "ngn",
  sourceAccount: "source-a",
  beneficiaryAccount: "beneficiary-a",
};

describe("payment REST routes", () => {
  it("requires a bearer principal", async () => {
    const deps = dependencies({ authenticate: vi.fn(async () => null) });
    const response = await request(app(deps)).get("/api/v1/payments/pay-a");
    expect(response.status).toBe(401);
    expect(response.body.error).toBe("BEARER_AUTHENTICATION_REQUIRED");
  });

  it("rejects a forged tenant header before policy evaluation", async () => {
    const deps = dependencies();
    const response = await request(app(deps))
      .get("/api/v1/payments/pay-a")
      .set("x-tenant-id", "tenant-b");
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("TENANT_HEADER_MISMATCH");
    expect(deps.evaluatePolicy).not.toHaveBeenCalled();
  });

  it("denies a cross-tenant payment before OPA or Permify lookup", async () => {
    const deps = dependencies();
    deps.repo.state = payment({ tenantId: "tenant-b" });
    const response = await request(app(deps)).get("/api/v1/payments/pay-a");
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("CROSS_TENANT_ACCESS_DENIED");
    expect(response.headers.traceparent).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/
    );
    expect(response.headers["x-authorization-decision-id"]).toMatch(/^read:/);
    expect(deps.evaluatePolicy).not.toHaveBeenCalled();
  });

  it("returns a redacted same-tenant payment only after OPA and Permify allow", async () => {
    const deps = dependencies();
    const response = await request(app(deps)).get("/api/v1/payments/pay-a");
    expect(response.status).toBe(200);
    expect(response.body.payment.paymentId).toBe("pay-a");
    expect(response.body.payment).not.toHaveProperty("metadata");
    expect(deps.evaluatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "read", tenantId: "tenant-a" })
    );
    expect(deps.requirePermission).toHaveBeenCalledWith({
      entityType: "payment",
      entityId: "pay-a",
      permission: "read",
      subjectId: "subject-a",
    });
  });

  it("fails closed when Permify is unavailable", async () => {
    const deps = dependencies({
      requirePermission: vi.fn(async () => {
        throw new PermifyUnavailableError();
      }),
    });
    const response = await request(app(deps)).get("/api/v1/payments/pay-a");
    expect(response.status).toBe(503);
    expect(response.body.error).toBe("AUTHORIZATION_DEPENDENCY_UNAVAILABLE");
  });

  it("does not resubmit an external workflow for an idempotency replay", async () => {
    const deps = dependencies();
    let created = true;
    const claimWorkflowDispatch = vi.spyOn(deps.repo, "claimWorkflowDispatch");
    deps.repo.admitIdempotent = vi.fn(async input => {
      deps.repo.state = { ...deps.repo.state, ...input } as PaymentSession;
      const result = { payment: deps.repo.state, created };
      created = false;
      return result;
    });
    const first = await request(app(deps))
      .post("/api/v1/payments")
      .set("idempotency-key", "replay-safe-key")
      .send(validCommand);
    const replay = await request(app(deps))
      .post("/api/v1/payments")
      .set("idempotency-key", "replay-safe-key")
      .send(validCommand);
    expect(first.status).toBe(202);
    expect(replay.status).toBe(200);
    expect(replay.body.idempotencyReplayed).toBe(true);
    expect(deps.submitWorkflow).toHaveBeenCalledTimes(1);
    expect(claimWorkflowDispatch).toHaveBeenCalledTimes(1);
  });

  it("requires a valid idempotency key for payment admission", async () => {
    const deps = dependencies();
    const response = await request(app(deps))
      .post("/api/v1/payments")
      .send(validCommand);
    expect(response.status).toBe(400);
    expect(response.body.error).toBe("VALID_IDEMPOTENCY_KEY_REQUIRED");
  });

  it("atomically admits a payment, writes its tuple, and starts one workflow", async () => {
    const deps = dependencies();
    const response = await request(app(deps))
      .post("/api/v1/payments")
      .set("idempotency-key", "idem-created")
      .send(validCommand);
    expect(response.status).toBe(202);
    expect(response.body.paymentId).toBe("pay-created");
    expect(response.body.workflowId).toBe("workflow-pay-created");
    expect(deps.requirePermission).toHaveBeenCalledWith({
      entityType: "merchant",
      entityId: "7",
      permission: "write",
      subjectId: "subject-a",
    });
    expect(deps.writeRelationship).toHaveBeenCalledWith({
      entityType: "payment",
      entityId: "pay-created",
      relation: "merchant",
      subjectType: "merchant",
      subjectId: "7",
    });
    expect(deps.submitWorkflow).toHaveBeenCalledTimes(1);
  });

  it("repairs the idempotent tuple on replay without starting an existing workflow again", async () => {
    const deps = dependencies();
    deps.repo.admitIdempotent = vi.fn(async () => ({
      payment: payment({
        sessionId: "pay-existing",
        workflowId: "workflow-existing",
      }),
      created: false,
    }));
    const response = await request(app(deps))
      .post("/api/v1/payments")
      .set("idempotency-key", "idem-existing")
      .send(validCommand);
    expect(response.status).toBe(200);
    expect(response.body.idempotencyReplayed).toBe(true);
    expect(response.body.paymentId).toBe("pay-existing");
    expect(deps.writeRelationship).toHaveBeenCalledTimes(1);
    expect(deps.submitWorkflow).not.toHaveBeenCalled();
  });

  it("returns 409 when the idempotency key is reused for a different request", async () => {
    const deps = dependencies();
    deps.repo.admitIdempotent = vi.fn(async () => {
      throw new PaymentIdempotencyConflictError();
    });
    const response = await request(app(deps))
      .post("/api/v1/payments")
      .set("idempotency-key", "idem-conflict")
      .send(validCommand);
    expect(response.status).toBe(409);
  });

  it("marks an admitted payment reconciliation-required and returns 503 if orchestration is unavailable", async () => {
    const deps = dependencies({
      submitWorkflow: vi.fn(async () => {
        throw new PaymentOrchestratorUnavailableError();
      }),
    });
    const response = await request(app(deps))
      .post("/api/v1/payments")
      .set("idempotency-key", "idem-outage")
      .send(validCommand);
    expect(response.status).toBe(503);
    expect(deps.repo.state.status).toBe("reconciliation_required");
  });

  it("requires verified MFA before evaluating an admin approval", async () => {
    const deps = dependencies();
    const response = await request(app(deps)).post(
      "/api/v1/admin/payments/pay-a/approve"
    );
    expect(response.status).toBe(403);
    expect(response.body.error).toBe("VERIFIED_MFA_REQUIRED");
    expect(deps.evaluatePolicy).not.toHaveBeenCalled();
  });

  it("approves a same-tenant payment and starts the workflow once", async () => {
    const deps = dependencies({
      authenticate: vi.fn(async () =>
        principal({ roles: ["admin"], mfaVerified: true })
      ),
    });
    const response = await request(app(deps)).post(
      "/api/v1/admin/payments/pay-a/approve"
    );
    expect(response.status).toBe(200);
    expect(response.body.decision).toBe("approved");
    expect(response.body.payment.workflowId).toBe("workflow-pay-a");
    expect(deps.evaluatePolicy).toHaveBeenCalledWith(
      expect.objectContaining({ action: "approve_payment", source: "admin" })
    );
    expect(deps.requirePermission).toHaveBeenCalledWith({
      entityType: "payment",
      entityId: "pay-a",
      permission: "approve",
      subjectId: "subject-a",
    });
    expect(deps.submitWorkflow).toHaveBeenCalledTimes(1);
  });
});
