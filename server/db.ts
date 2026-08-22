import { eq, and, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createChildLogger } from "./lib/logger";

const log = createChildLogger("database");
import {
  InsertUser,
  users,
  merchants,
  InsertMerchant,
  Merchant,
  paymentSessions,
  InsertPaymentSession,
  PaymentSession,
  transactions,
  InsertTransaction,
  Transaction,
  refunds,
  InsertRefund,
  Refund,
  webhooks,
  InsertWebhook,
  Webhook,
  webhookLogs,
  InsertWebhookLog,
  WebhookLog,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _pool: pg.Pool | null = null;

function positiveInt(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

// Lazily create a connection-pooled drizzle instance.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      const statementTimeout = positiveInt("PG_STATEMENT_TIMEOUT_MS", 30_000);
      _pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        max: positiveInt("PG_POOL_MAX", 25),
        min: Number(process.env.PG_POOL_MIN ?? 0),
        idleTimeoutMillis: positiveInt("PG_IDLE_TIMEOUT_MS", 30_000),
        connectionTimeoutMillis: positiveInt("PG_CONNECTION_TIMEOUT_MS", 5_000),
        maxUses:
          Number(process.env.PG_MAX_USES ?? 0) > 0
            ? Number(process.env.PG_MAX_USES)
            : undefined,
        options: `-c statement_timeout=${statementTimeout}`,
      });
      _db = drizzle(_pool);
    } catch (error) {
      log.warn({ err: error }, "Failed to connect to database");
      _db = null;
    }
  }
  return _db;
}

/** Like getDb() but throws instead of returning null — use in tRPC routers. */
export async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.sub) {
    throw new Error("User sub is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    throw new Error("PostgreSQL is required for user persistence");
  }

  try {
    const values: InsertUser = {
      sub: user.sub,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.sub === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onConflictDoUpdate({
      target: users.sub,
      set: updateSet,
    });
  } catch (error) {
    log.error({ err: error }, "Failed to upsert user");
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    log.warn("Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.sub, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// ==================== Merchant Operations ====================

export async function createMerchant(
  merchant: InsertMerchant
): Promise<Merchant> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(merchants).values(merchant).returning();
  return result[0]!;
}

export async function getMerchantById(
  id: number
): Promise<Merchant | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(merchants)
    .where(eq(merchants.id, id))
    .limit(1);
  return result[0];
}

export async function getMerchantByApiKey(
  apiKey: string
): Promise<Merchant | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(merchants)
    .where(eq(merchants.apiKey, apiKey))
    .limit(1);
  return result[0];
}

export async function getMerchantsByUserId(
  userId: number
): Promise<Merchant[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(merchants).where(eq(merchants.userId, userId));
}

export async function updateMerchant(
  id: number,
  updates: Partial<InsertMerchant>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(merchants).set(updates).where(eq(merchants.id, id));
}

// ==================== Payment Session Operations ====================

export async function createPaymentSession(
  session: InsertPaymentSession
): Promise<PaymentSession> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(paymentSessions).values(session).returning();
  return result[0]!;
}

export async function getPaymentSessionBySessionId(
  sessionId: string
): Promise<PaymentSession | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(paymentSessions)
    .where(eq(paymentSessions.sessionId, sessionId))
    .limit(1);
  return result[0];
}

export async function getPaymentSessionsByMerchant(
  merchantId: number,
  limit = 50
): Promise<PaymentSession[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(paymentSessions)
    .where(eq(paymentSessions.merchantId, merchantId))
    .orderBy(desc(paymentSessions.createdAt))
    .limit(limit);
}

export async function updatePaymentSession(
  sessionId: string,
  updates: Partial<InsertPaymentSession>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(paymentSessions)
    .set(updates)
    .where(eq(paymentSessions.sessionId, sessionId));
}

// ==================== Transaction Operations ====================

export async function createTransaction(
  transaction: InsertTransaction
): Promise<Transaction> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(transactions).values(transaction).returning();
  return result[0]!;
}

export async function getTransactionByTransactionId(
  transactionId: string
): Promise<Transaction | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(transactions)
    .where(eq(transactions.transactionId, transactionId))
    .limit(1);
  return result[0];
}

export async function getTransactionsBySessionId(
  sessionId: string
): Promise<Transaction[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(transactions)
    .where(eq(transactions.sessionId, sessionId))
    .orderBy(desc(transactions.createdAt));
}

export async function getTransactionsByMerchant(
  merchantId: number,
  limit = 100
): Promise<Transaction[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(transactions)
    .where(eq(transactions.merchantId, merchantId))
    .orderBy(desc(transactions.createdAt))
    .limit(limit);
}

export async function updateTransaction(
  transactionId: string,
  updates: Partial<InsertTransaction>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(transactions)
    .set(updates)
    .where(eq(transactions.transactionId, transactionId));
}

// ==================== Refund Operations ====================

export async function createRefund(refund: InsertRefund): Promise<Refund> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(refunds).values(refund).returning();
  return result[0]!;
}

export async function getRefundsByTransaction(
  transactionId: string
): Promise<Refund[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(refunds)
    .where(eq(refunds.transactionId, transactionId))
    .orderBy(desc(refunds.createdAt));
}

export async function updateRefund(
  refundId: string,
  updates: Partial<InsertRefund>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(refunds).set(updates).where(eq(refunds.refundId, refundId));
}

// ==================== Webhook Log Operations ====================

export async function createWebhookLog(
  log: InsertWebhookLog
): Promise<WebhookLog> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(webhookLogs).values(log).returning();
  return result[0]!;
}

export async function getWebhookLogsByMerchant(
  merchantId: number,
  limit = 100
): Promise<WebhookLog[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(webhookLogs)
    .where(eq(webhookLogs.merchantId, merchantId))
    .orderBy(desc(webhookLogs.createdAt))
    .limit(limit);
}

export async function updateWebhookLog(
  id: number,
  updates: Partial<InsertWebhookLog>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(webhookLogs).set(updates).where(eq(webhookLogs.id, id));
}

// ==================== Webhook Operations ====================

export async function getWebhooksByMerchantId(
  merchantId: number
): Promise<Webhook[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(webhooks).where(eq(webhooks.merchantId, merchantId));
}
