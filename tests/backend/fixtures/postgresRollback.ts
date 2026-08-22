import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { getDb } from "../../../server/db";

const ROLLBACK = Symbol("TEST_ROLLBACK");

export class PostgresIntegrationUnavailableError extends Error {
  constructor() {
    super("PostgreSQL integration requires DATABASE_URL");
    this.name = "PostgresIntegrationUnavailableError";
  }
}

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function withPostgresRollback<T>(
  callback: (tx: Transaction) => Promise<T>
): Promise<T | undefined> {
  const db = await getDb();
  if (!db) throw new PostgresIntegrationUnavailableError();
  let result: T | undefined;
  try {
    await db.transaction(async tx => {
      result = await callback(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return result;
}

export function integrationEnabled(): boolean {
  return (
    process.env.RUN_POSTGRES_INTEGRATION === "true" &&
    Boolean(process.env.DATABASE_URL)
  );
}

export type { Database, Transaction };
