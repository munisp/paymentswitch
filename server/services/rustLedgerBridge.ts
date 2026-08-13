import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { prefundAccounts } from '../../drizzle/schema';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('rustLedgerBridge');
const RUST_LEDGER_URL = process.env.RUST_LEDGER_SERVICE_URL;

interface LedgerResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  source: 'tigerbeetle_ledger';
}

async function callLedger<T>(path: string, method: 'GET' | 'POST' = 'POST', body?: unknown): Promise<LedgerResponse<T>> {
  if (!RUST_LEDGER_URL) {
    return { ok: false, error: 'RUST_LEDGER_SERVICE_URL is not configured', source: 'tigerbeetle_ledger' };
  }

  try {
    const response = await fetch(`${RUST_LEDGER_URL.replace(/\/$/, '')}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return { ok: false, error: `Ledger request failed: HTTP ${response.status} ${response.statusText}`, source: 'tigerbeetle_ledger' };
    }

    return { ok: true, data: await response.json() as T, source: 'tigerbeetle_ledger' };
  } catch (error) {
    log.warn({ err: error, path }, 'TigerBeetle ledger request failed');
    return {
      ok: false,
      error: error instanceof Error ? `Ledger request failed: ${error.message}` : 'Ledger request failed',
      source: 'tigerbeetle_ledger',
    };
  }
}

export interface LedgerAccount {
  accountRef: string;
  participantId: number;
  balance: string;
  pendingDebits: string;
  pendingCredits: string;
  accountFamily: string;
}

export async function getAccountBalance(participantId: number): Promise<LedgerResponse<LedgerAccount>> {
  return callLedger<LedgerAccount>(`/api/accounts/${encodeURIComponent(String(participantId))}/balance`, 'GET');
}

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

/**
 * Financial postings are authoritative only when the ledger accepts them. The
 * function intentionally never writes an accounting fallback to PostgreSQL.
 */
export async function createPosting(request: PostingRequest): Promise<LedgerResponse<PostingResponse>> {
  return callLedger<PostingResponse>('/api/postings', 'POST', request);
}

export interface ReconciliationResult {
  participantId: number;
  ledgerBalance: string;
  dbBalance: string;
  difference: string;
  status: 'matched' | 'mismatch';
}

/**
 * PostgreSQL may be used as a read-only operational projection for comparison,
 * but never as a substitute for a missing ledger response.
 */
export async function reconcileAccount(participantId: number): Promise<LedgerResponse<ReconciliationResult>> {
  const ledger = await getAccountBalance(participantId);
  if (!ledger.ok || !ledger.data) {
    return { ok: false, error: ledger.error ?? 'Ledger balance is unavailable', source: 'tigerbeetle_ledger' };
  }

  const db = await getDb();
  if (!db) {
    return { ok: false, error: 'PostgreSQL projection is unavailable for reconciliation', source: 'tigerbeetle_ledger' };
  }

  const rows = await db.select({ balance: prefundAccounts.balance })
    .from(prefundAccounts)
    .where(eq(prefundAccounts.participantId, participantId))
    .limit(1);
  const dbBalance = rows[0]?.balance;
  if (dbBalance === undefined) {
    return { ok: false, error: 'PostgreSQL projection account was not found', source: 'tigerbeetle_ledger' };
  }

  const ledgerBalance = ledger.data.balance;
  const difference = Math.abs(Number(ledgerBalance) - Number(dbBalance));
  if (!Number.isFinite(difference)) {
    return { ok: false, error: 'Ledger or projection balance is not numeric', source: 'tigerbeetle_ledger' };
  }

  return {
    ok: true,
    source: 'tigerbeetle_ledger',
    data: {
      participantId,
      ledgerBalance,
      dbBalance,
      difference: difference.toFixed(2),
      status: difference < 0.01 ? 'matched' : 'mismatch',
    },
  };
}

export async function checkLedgerHealth(): Promise<{ available: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now();
  if (!RUST_LEDGER_URL) {
    return { available: false, latencyMs: 0, error: 'RUST_LEDGER_SERVICE_URL is not configured' };
  }

  try {
    const response = await fetch(`${RUST_LEDGER_URL.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3_000) });
    return {
      available: response.ok,
      latencyMs: Date.now() - startedAt,
      ...(response.ok ? {} : { error: `HTTP ${response.status} ${response.statusText}` }),
    };
  } catch (error) {
    return {
      available: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'Health probe failed',
    };
  }
}
