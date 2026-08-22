import { and, desc, eq } from "drizzle-orm";
import { PgDatabase, PgTransaction } from "drizzle-orm/pg-core";
import { getDb } from "../db";
import {
  paymentSessions,
  type InsertPaymentSession,
  type PaymentSession,
} from "../../drizzle/schema";

export class PaymentRepositoryUnavailableError extends Error {
  constructor() {
    super("PostgreSQL payment repository is unavailable");
    this.name = "PaymentRepositoryUnavailableError";
  }
}

export class PaymentSessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Payment session ${sessionId} was not found`);
    this.name = "PaymentSessionNotFoundError";
  }
}

export class PaymentIdempotencyConflictError extends Error {
  constructor() {
    super(
      "The idempotency key was already used with a different payment request"
    );
    this.name = "PaymentIdempotencyConflictError";
  }
}

export class PaymentStateConflictError extends Error {
  constructor(status: string) {
    super(`Payment cannot be approved from status ${status}`);
    this.name = "PaymentStateConflictError";
  }
}

type DbExecutor = PgDatabase<any, any, any> | PgTransaction<any, any, any>;

function assertLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError(
      "payment session limit must be an integer from 1 to 100"
    );
  }
  return limit;
}

async function requireDatabase(): Promise<PgDatabase<any, any, any>> {
  const db = await getDb();
  if (!db) throw new PaymentRepositoryUnavailableError();
  return db;
}

export class PaymentRepository {
  constructor(private readonly db: DbExecutor) {}

  async insert(input: InsertPaymentSession): Promise<PaymentSession> {
    const rows = await this.db
      .insert(paymentSessions)
      .values(input)
      .returning();
    const created = rows[0];
    if (!created) throw new Error("payment session insert returned no row");
    return created;
  }

  async admitIdempotent(
    input: InsertPaymentSession & {
      tenantId: string;
      idempotencyKey: string;
      requestHash: string;
    }
  ): Promise<{ payment: PaymentSession; created: boolean }> {
    const rows = await this.db
      .insert(paymentSessions)
      .values(input)
      .onConflictDoNothing({
        target: [paymentSessions.tenantId, paymentSessions.idempotencyKey],
      })
      .returning();
    if (rows[0]) return { payment: rows[0], created: true };

    const existing = await this.db
      .select()
      .from(paymentSessions)
      .where(
        and(
          eq(paymentSessions.tenantId, input.tenantId),
          eq(paymentSessions.idempotencyKey, input.idempotencyKey)
        )
      )
      .limit(1);
    const payment = existing[0];
    if (!payment) throw new PaymentRepositoryUnavailableError();
    if (payment.requestHash !== input.requestHash)
      throw new PaymentIdempotencyConflictError();
    return { payment, created: false };
  }

  async findBySessionId(
    sessionId: string
  ): Promise<PaymentSession | undefined> {
    const rows = await this.db
      .select()
      .from(paymentSessions)
      .where(eq(paymentSessions.sessionId, sessionId))
      .limit(1);
    return rows[0];
  }

  async findForTenant(
    tenantId: string,
    sessionId: string
  ): Promise<PaymentSession | undefined> {
    const rows = await this.db
      .select()
      .from(paymentSessions)
      .where(
        and(
          eq(paymentSessions.tenantId, tenantId),
          eq(paymentSessions.sessionId, sessionId)
        )
      )
      .limit(1);
    return rows[0];
  }

  async findForMerchant(
    merchantId: number,
    sessionId: string
  ): Promise<PaymentSession | undefined> {
    const rows = await this.db
      .select()
      .from(paymentSessions)
      .where(
        and(
          eq(paymentSessions.merchantId, merchantId),
          eq(paymentSessions.sessionId, sessionId)
        )
      )
      .limit(1);
    return rows[0];
  }

  async requireForMerchant(
    merchantId: number,
    sessionId: string
  ): Promise<PaymentSession> {
    const session = await this.findForMerchant(merchantId, sessionId);
    if (!session) throw new PaymentSessionNotFoundError(sessionId);
    return session;
  }

  async listForMerchant(
    merchantId: number,
    limit = 50
  ): Promise<PaymentSession[]> {
    assertLimit(limit);
    return this.db
      .select()
      .from(paymentSessions)
      .where(eq(paymentSessions.merchantId, merchantId))
      .orderBy(desc(paymentSessions.createdAt), desc(paymentSessions.id))
      .limit(limit);
  }

  async updateForMerchant(
    merchantId: number,
    sessionId: string,
    updates: Partial<InsertPaymentSession>
  ): Promise<PaymentSession> {
    const rows = await this.db
      .update(paymentSessions)
      .set({ ...updates, updatedAt: new Date() })
      .where(
        and(
          eq(paymentSessions.merchantId, merchantId),
          eq(paymentSessions.sessionId, sessionId)
        )
      )
      .returning();
    const updated = rows[0];
    if (!updated) throw new PaymentSessionNotFoundError(sessionId);
    return updated;
  }

  /** Atomically claims dispatch before an external payment rail is contacted. */
  async claimWorkflowDispatch(
    tenantId: string,
    sessionId: string
  ): Promise<{ payment: PaymentSession; claimed: boolean }> {
    const rows = await this.db
      .update(paymentSessions)
      .set({ status: "processing", updatedAt: new Date() })
      .where(
        and(
          eq(paymentSessions.tenantId, tenantId),
          eq(paymentSessions.sessionId, sessionId),
          eq(paymentSessions.status, "pending")
        )
      )
      .returning();
    if (rows[0]) return { payment: rows[0], claimed: true };
    const existing = await this.findForTenant(tenantId, sessionId);
    if (!existing) throw new PaymentSessionNotFoundError(sessionId);
    return { payment: existing, claimed: false };
  }

  async setWorkflowForTenant(
    tenantId: string,
    sessionId: string,
    workflowId: string
  ): Promise<PaymentSession> {
    const rows = await this.db
      .update(paymentSessions)
      .set({ workflowId, updatedAt: new Date() })
      .where(
        and(
          eq(paymentSessions.tenantId, tenantId),
          eq(paymentSessions.sessionId, sessionId),
          eq(paymentSessions.status, "processing")
        )
      )
      .returning();
    if (rows[0]) return rows[0];
    const existing = await this.findForTenant(tenantId, sessionId);
    if (!existing) throw new PaymentSessionNotFoundError(sessionId);
    if (existing.workflowId === workflowId) return existing;
    throw new PaymentStateConflictError(existing.status);
  }

  /**
   * A network timeout or ambiguous external error cannot be called a failed payment.
   * Preserve it for ledger/provider reconciliation instead of allowing automatic replay.
   */
  async markReconciliationRequiredForTenant(
    tenantId: string,
    sessionId: string
  ): Promise<void> {
    await this.db
      .update(paymentSessions)
      .set({ status: "reconciliation_required", updatedAt: new Date() })
      .where(
        and(
          eq(paymentSessions.tenantId, tenantId),
          eq(paymentSessions.sessionId, sessionId),
          eq(paymentSessions.status, "processing")
        )
      );
  }

  async failAdmissionForTenant(
    tenantId: string,
    sessionId: string
  ): Promise<void> {
    await this.db
      .update(paymentSessions)
      .set({ status: "failed", updatedAt: new Date() })
      .where(
        and(
          eq(paymentSessions.tenantId, tenantId),
          eq(paymentSessions.sessionId, sessionId),
          eq(paymentSessions.status, "pending")
        )
      );
  }

  async approveForTenant(
    tenantId: string,
    sessionId: string,
    subject: string
  ): Promise<{ payment: PaymentSession; transitioned: boolean }> {
    const rows = await this.db
      .update(paymentSessions)
      .set({
        status: "processing",
        approvedAt: new Date(),
        approvedBySubject: subject,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(paymentSessions.tenantId, tenantId),
          eq(paymentSessions.sessionId, sessionId),
          eq(paymentSessions.status, "pending")
        )
      )
      .returning();
    if (rows[0]) return { payment: rows[0], transitioned: true };
    const existing = await this.findForTenant(tenantId, sessionId);
    if (!existing) throw new PaymentSessionNotFoundError(sessionId);
    if (
      existing.approvedBySubject === subject &&
      existing.status === "processing"
    )
      return { payment: existing, transitioned: false };
    throw new PaymentStateConflictError(existing.status);
  }
}

export async function getPaymentRepository(): Promise<PaymentRepository> {
  return new PaymentRepository(await requireDatabase());
}

export async function insertPaymentSession(
  input: InsertPaymentSession
): Promise<PaymentSession> {
  return (await getPaymentRepository()).insert(input);
}

export async function findPaymentSessionForMerchant(
  merchantId: number,
  sessionId: string
): Promise<PaymentSession | undefined> {
  return (await getPaymentRepository()).findForMerchant(merchantId, sessionId);
}

export async function requirePaymentSessionForMerchant(
  merchantId: number,
  sessionId: string
): Promise<PaymentSession> {
  return (await getPaymentRepository()).requireForMerchant(
    merchantId,
    sessionId
  );
}

export async function listPaymentSessionsForMerchant(
  merchantId: number,
  limit = 50
): Promise<PaymentSession[]> {
  return (await getPaymentRepository()).listForMerchant(merchantId, limit);
}

export async function updatePaymentSessionForMerchant(
  merchantId: number,
  sessionId: string,
  updates: Partial<InsertPaymentSession>
): Promise<PaymentSession> {
  return (await getPaymentRepository()).updateForMerchant(
    merchantId,
    sessionId,
    updates
  );
}
