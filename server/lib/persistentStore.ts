import { createChildLogger } from './logger';

const log = createChildLogger('persistentStore');

type SerializableValue = Record<string, unknown> | Array<Record<string, unknown>>;
type QueryablePool = {
  query: (query: string, parameters?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount?: number | null }>;
};

/**
 * Migration-managed PostgreSQL key-value store. It deliberately has no
 * process-memory fallback: callers must surface storage outages instead of
 * returning plausible but non-durable data.
 */
export class PersistentStore {
  constructor(private readonly namespace: string) {}

  private async requirePool(): Promise<QueryablePool> {
    const { getDb } = await import('../db');
    const db = await getDb();
    const pool = db ? (db as unknown as { $client?: QueryablePool }).$client : undefined;
    if (!pool?.query) {
      throw new Error(`PostgreSQL is unavailable for persistent store namespace ${this.namespace}`);
    }
    return pool;
  }

  async set(key: string, data: SerializableValue, ttlMs?: number): Promise<void> {
    const pool = await this.requirePool();
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null;
    try {
      await pool.query(
        `INSERT INTO persistent_store (namespace, key, data, expires_at, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, NOW())
         ON CONFLICT (namespace, key)
         DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at, updated_at = NOW()`,
        [this.namespace, key, JSON.stringify(data), expiresAt],
      );
    } catch (error) {
      log.error({ err: error, namespace: this.namespace, key }, 'Persistent store write failed');
      throw error;
    }
  }

  async get<T = SerializableValue>(key: string): Promise<T | null> {
    const pool = await this.requirePool();
    const result = await pool.query(
      `SELECT data FROM persistent_store
       WHERE namespace = $1 AND key = $2
       AND (expires_at IS NULL OR expires_at > NOW())`,
      [this.namespace, key],
    );
    return result.rows.length > 0 ? result.rows[0].data as T : null;
  }

  async list<T = SerializableValue>(limit = 1000, offset = 0): Promise<T[]> {
    const pool = await this.requirePool();
    const result = await pool.query(
      `SELECT data FROM persistent_store
       WHERE namespace = $1
       AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [this.namespace, limit, offset],
    );
    return result.rows.map(row => row.data as T);
  }

  async delete(key: string): Promise<boolean> {
    const pool = await this.requirePool();
    const result = await pool.query(
      'DELETE FROM persistent_store WHERE namespace = $1 AND key = $2',
      [this.namespace, key],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async count(): Promise<number> {
    const pool = await this.requirePool();
    const result = await pool.query(
      `SELECT COUNT(*)::integer AS count FROM persistent_store
       WHERE namespace = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [this.namespace],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async update(key: string, updater: (data: SerializableValue) => SerializableValue): Promise<boolean> {
    const current = await this.get<SerializableValue>(key);
    if (!current) return false;
    await this.set(key, updater(current));
    return true;
  }

  async cleanup(): Promise<number> {
    const pool = await this.requirePool();
    const result = await pool.query(
      'DELETE FROM persistent_store WHERE namespace = $1 AND expires_at IS NOT NULL AND expires_at <= NOW()',
      [this.namespace],
    );
    return result.rowCount ?? 0;
  }
}

const storeInstances = new Map<string, PersistentStore>();

export function getStore(namespace: string): PersistentStore {
  let store = storeInstances.get(namespace);
  if (!store) {
    store = new PersistentStore(namespace);
    storeInstances.set(namespace, store);
  }
  return store;
}
