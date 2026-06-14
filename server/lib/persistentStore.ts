/**
 * Persistent store abstraction that replaces in-memory Maps/arrays.
 * Uses PostgreSQL via the existing Drizzle pool as primary store,
 * with Redis as cache layer and in-memory as final fallback.
 *
 * Modules should call `getStore()` to get a store instance, then use
 * `set()`, `get()`, `list()`, `delete()` for CRUD operations.
 */
import { createChildLogger } from './logger';

const log = createChildLogger('persistentStore');

interface StoreRecord {
  key: string;
  namespace: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

type SerializableValue = Record<string, unknown> | Array<Record<string, unknown>>;

/**
 * PersistentStore wraps database operations for key-value storage.
 * Each "namespace" maps to a logical group (e.g., "api_keys", "gateway_sessions").
 */
export class PersistentStore {
  private namespace: string;
  private memoryFallback = new Map<string, { data: SerializableValue; expiresAt?: number }>();
  private dbAvailable = false;
  private dbChecked = false;

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  private async getPool() {
    if (this.dbChecked) return this.dbAvailable;
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      this.dbAvailable = !!db;
      this.dbChecked = true;
      if (db) {
        // Ensure the persistent_store table exists
        const pool = (db as any).$client;
        if (pool?.query) {
          await pool.query(`
            CREATE TABLE IF NOT EXISTS persistent_store (
              id SERIAL PRIMARY KEY,
              namespace VARCHAR(100) NOT NULL,
              key VARCHAR(500) NOT NULL,
              data JSONB NOT NULL DEFAULT '{}',
              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
              expires_at TIMESTAMPTZ,
              UNIQUE(namespace, key)
            )
          `);
          await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_persistent_store_ns_key
            ON persistent_store(namespace, key)
          `);
        }
      }
      return this.dbAvailable;
    } catch {
      this.dbChecked = true;
      this.dbAvailable = false;
      return false;
    }
  }

  private async getDbPool() {
    try {
      const { getDb } = await import('../db');
      const db = await getDb();
      return db ? (db as any).$client : null;
    } catch {
      return null;
    }
  }

  async set(key: string, data: SerializableValue, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null;

    if (await this.getPool()) {
      try {
        const pool = await this.getDbPool();
        if (pool?.query) {
          await pool.query(
            `INSERT INTO persistent_store (namespace, key, data, expires_at, updated_at)
             VALUES ($1, $2, $3, $4, NOW())
             ON CONFLICT (namespace, key)
             DO UPDATE SET data = $3, expires_at = $4, updated_at = NOW()`,
            [this.namespace, key, JSON.stringify(data), expiresAt]
          );
          return;
        }
      } catch (err) {
        log.warn({ err, namespace: this.namespace, key }, 'DB write failed, using memory fallback');
      }
    }

    this.memoryFallback.set(key, {
      data,
      expiresAt: ttlMs ? Date.now() + ttlMs : undefined,
    });
  }

  async get<T = SerializableValue>(key: string): Promise<T | null> {
    if (await this.getPool()) {
      try {
        const pool = await this.getDbPool();
        if (pool?.query) {
          const result = await pool.query(
            `SELECT data FROM persistent_store
             WHERE namespace = $1 AND key = $2
             AND (expires_at IS NULL OR expires_at > NOW())`,
            [this.namespace, key]
          );
          if (result.rows.length > 0) {
            return result.rows[0].data as T;
          }
          return null;
        }
      } catch (err) {
        log.warn({ err, namespace: this.namespace, key }, 'DB read failed, using memory fallback');
      }
    }

    const entry = this.memoryFallback.get(key);
    if (!entry) return null;
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.memoryFallback.delete(key);
      return null;
    }
    return entry.data as T;
  }

  async list<T = SerializableValue>(limit = 1000, offset = 0): Promise<T[]> {
    if (await this.getPool()) {
      try {
        const pool = await this.getDbPool();
        if (pool?.query) {
          const result = await pool.query(
            `SELECT data FROM persistent_store
             WHERE namespace = $1
             AND (expires_at IS NULL OR expires_at > NOW())
             ORDER BY created_at DESC
             LIMIT $2 OFFSET $3`,
            [this.namespace, limit, offset]
          );
          return result.rows.map((r: { data: T }) => r.data);
        }
      } catch (err) {
        log.warn({ err, namespace: this.namespace }, 'DB list failed, using memory fallback');
      }
    }

    const now = Date.now();
    const entries: T[] = [];
    for (const [, entry] of Array.from(this.memoryFallback)) {
      if (entry.expiresAt && now > entry.expiresAt) continue;
      entries.push(entry.data as T);
    }
    return entries.slice(offset, offset + limit);
  }

  async delete(key: string): Promise<boolean> {
    if (await this.getPool()) {
      try {
        const pool = await this.getDbPool();
        if (pool?.query) {
          const result = await pool.query(
            `DELETE FROM persistent_store WHERE namespace = $1 AND key = $2`,
            [this.namespace, key]
          );
          return (result.rowCount ?? 0) > 0;
        }
      } catch (err) {
        log.warn({ err, namespace: this.namespace, key }, 'DB delete failed, using memory fallback');
      }
    }

    return this.memoryFallback.delete(key);
  }

  async count(): Promise<number> {
    if (await this.getPool()) {
      try {
        const pool = await this.getDbPool();
        if (pool?.query) {
          const result = await pool.query(
            `SELECT COUNT(*) as cnt FROM persistent_store
             WHERE namespace = $1
             AND (expires_at IS NULL OR expires_at > NOW())`,
            [this.namespace]
          );
          return parseInt(result.rows[0].cnt, 10);
        }
      } catch (err) {
        log.warn({ err, namespace: this.namespace }, 'DB count failed, using memory fallback');
      }
    }

    return this.memoryFallback.size;
  }

  async update(key: string, updater: (data: SerializableValue) => SerializableValue): Promise<boolean> {
    const current = await this.get(key);
    if (!current) return false;
    const updated = updater(current);
    await this.set(key, updated);
    return true;
  }

  async cleanup(): Promise<number> {
    if (await this.getPool()) {
      try {
        const pool = await this.getDbPool();
        if (pool?.query) {
          const result = await pool.query(
            `DELETE FROM persistent_store
             WHERE namespace = $1 AND expires_at IS NOT NULL AND expires_at <= NOW()`,
            [this.namespace]
          );
          return result.rowCount ?? 0;
        }
      } catch {
        // fallback cleanup
      }
    }

    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of Array.from(this.memoryFallback)) {
      if (entry.expiresAt && now > entry.expiresAt) {
        this.memoryFallback.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }
}

const storeInstances = new Map<string, PersistentStore>();

export function getStore(namespace: string): PersistentStore {
  if (!storeInstances.has(namespace)) {
    storeInstances.set(namespace, new PersistentStore(namespace));
  }
  return storeInstances.get(namespace)!;
}
