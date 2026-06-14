/**
 * Rust Ledger Service Bridge
 * 
 * HTTP client for the Rust double-entry ledger service (TigerBeetle-style).
 * Handles:
 * - Account creation/lookup
 * - Debit/credit postings (transfer debits, fee charges, settlements)
 * - Balance queries
 * - Reconciliation
 * 
 * Falls back to PostgreSQL prefund_accounts when Rust service is unavailable.
 */

import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { prefundAccounts } from '../../drizzle/schema';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('rustLedgerBridge');

const RUST_LEDGER_URL = process.env.RUST_LEDGER_SERVICE_URL || 'http://localhost:8301';

interface LedgerResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  source: 'rust_ledger' | 'pg_fallback';
}

async function callLedger<T>(path: string, method: 'GET' | 'POST' = 'POST', body?: unknown): Promise<LedgerResponse<T>> {
  try {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5_000),
    };
    if (body && method === 'POST') opts.body = JSON.stringify(body);
    
    const res = await fetch(`${RUST_LEDGER_URL}${path}`, opts);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, source: 'rust_ledger' };
    }
    const data = await res.json() as T;
    return { ok: true, data, source: 'rust_ledger' };
  } catch {
    log.debug({ path }, 'Rust ledger unavailable, using PostgreSQL fallback');
    return { ok: false, error: 'Ledger service unavailable', source: 'pg_fallback' };
  }
}

// ============================================================================
// ACCOUNT OPERATIONS
// ============================================================================

export interface LedgerAccount {
  accountRef: string;
  participantId: number;
  balance: string;
  pendingDebits: string;
  pendingCredits: string;
  accountFamily: string;
}

export async function getAccountBalance(participantId: number): Promise<LedgerResponse<LedgerAccount>> {
  const rustResult = await callLedger<LedgerAccount>(`/api/accounts/${participantId}/balance`, 'GET');
  if (rustResult.ok) return rustResult;
  
  // Fallback to PostgreSQL
  const db = await getDb();
  if (!db) return { ok: false, error: 'No database available', source: 'pg_fallback' };
  
  const rows = await (db as any).select().from(prefundAccounts)
    .where(eq(prefundAccounts.participantId, participantId)).limit(1);
  const account = rows[0];
  
  if (!account) return { ok: false, error: 'Account not found', source: 'pg_fallback' };
  
  return {
    ok: true,
    source: 'pg_fallback',
    data: {
      accountRef: account.accountRef,
      participantId: account.participantId,
      balance: account.balance,
      pendingDebits: '0.00',
      pendingCredits: '0.00',
      accountFamily: account.accountFamily,
    },
  };
}

// ============================================================================
// POSTING OPERATIONS
// ============================================================================

export interface PostingRequest {
  transferId: string;
  participantId: number;
  amountNgn: string;
  feeAmount?: string;
  type: 'debit_prefund' | 'credit_prefund' | 'settlement_confirm' | 'fee_charge' | 'void';
}

export interface PostingResponse {
  postingId: string;
  status: 'committed' | 'pending' | 'failed';
  balanceAfter: string;
  timestamp: string;
}

export async function createPosting(req: PostingRequest): Promise<LedgerResponse<PostingResponse>> {
  const rustResult = await callLedger<PostingResponse>('/api/postings', 'POST', req);
  if (rustResult.ok) return rustResult;
  
  // Fallback to PostgreSQL prefund update
  const db = await getDb();
  if (!db) return { ok: false, error: 'No database available', source: 'pg_fallback' };
  
  try {
    const amount = parseFloat(req.amountNgn);
    const fee = parseFloat(req.feeAmount ?? '0');
    
    if (req.type === 'debit_prefund' || req.type === 'fee_charge') {
      await (db as any).update(prefundAccounts).set({
        balance: sql`GREATEST(${prefundAccounts.balance}::numeric - ${amount + fee}::numeric, 0)`,
        todayDeductions: sql`${prefundAccounts.todayDeductions}::numeric + ${amount + fee}::numeric`,
        updatedAt: new Date(),
      }).where(eq(prefundAccounts.participantId, req.participantId));
    } else if (req.type === 'credit_prefund') {
      await (db as any).update(prefundAccounts).set({
        balance: sql`${prefundAccounts.balance}::numeric + ${amount}::numeric`,
        lastTopUpAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(prefundAccounts.participantId, req.participantId));
    } else if (req.type === 'void') {
      // Reverse a debit
      await (db as any).update(prefundAccounts).set({
        balance: sql`${prefundAccounts.balance}::numeric + ${amount + fee}::numeric`,
        todayDeductions: sql`GREATEST(${prefundAccounts.todayDeductions}::numeric - ${amount + fee}::numeric, 0)`,
        updatedAt: new Date(),
      }).where(eq(prefundAccounts.participantId, req.participantId));
    }
    
    // Read back balance
    const rows = await (db as any).select({ balance: prefundAccounts.balance })
      .from(prefundAccounts)
      .where(eq(prefundAccounts.participantId, req.participantId)).limit(1);
    
    return {
      ok: true,
      source: 'pg_fallback',
      data: {
        postingId: `pg-${Date.now()}`,
        status: 'committed',
        balanceAfter: rows[0]?.balance ?? '0.00',
        timestamp: new Date().toISOString(),
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Unknown error', source: 'pg_fallback' };
  }
}

// ============================================================================
// RECONCILIATION
// ============================================================================

export interface ReconciliationResult {
  participantId: number;
  ledgerBalance: string;
  dbBalance: string;
  difference: string;
  status: 'matched' | 'mismatch';
}

export async function reconcileAccount(participantId: number): Promise<LedgerResponse<ReconciliationResult>> {
  const [rustResult, dbResult] = await Promise.all([
    callLedger<{ balance: string }>(`/api/accounts/${participantId}/balance`, 'GET'),
    (async () => {
      const db = await getDb();
      if (!db) return null;
      const rows = await (db as any).select({ balance: prefundAccounts.balance })
        .from(prefundAccounts).where(eq(prefundAccounts.participantId, participantId)).limit(1);
      return rows[0]?.balance ?? '0.00';
    })(),
  ]);
  
  const ledgerBalance = rustResult.ok ? (rustResult.data?.balance ?? '0.00') : '0.00';
  const dbBalance = dbResult ?? '0.00';
  const diff = Math.abs(parseFloat(ledgerBalance) - parseFloat(dbBalance));
  
  return {
    ok: true,
    source: rustResult.ok ? 'rust_ledger' : 'pg_fallback',
    data: {
      participantId,
      ledgerBalance,
      dbBalance,
      difference: diff.toFixed(2),
      status: diff < 0.01 ? 'matched' : 'mismatch',
    },
  };
}

// ============================================================================
// HEALTH
// ============================================================================

export async function checkLedgerHealth(): Promise<{ available: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const res = await fetch(`${RUST_LEDGER_URL}/health`, { signal: AbortSignal.timeout(3_000) });
    return { available: res.ok, latencyMs: Date.now() - start };
  } catch {
    return { available: false, latencyMs: Date.now() - start };
  }
}
