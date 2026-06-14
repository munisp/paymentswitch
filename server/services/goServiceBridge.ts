/**
 * Go Service Bridge
 * 
 * HTTP client layer connecting the Node.js tRPC server to the Go microservices:
 * - Corridor Routing Engine (port 8201)
 * - Sanctions Screening Service (port 8202)
 * - Tiered Billing Service (port 8203)
 * - Mojaloop Hub Router (port 8204)
 * 
 * When Go services are unavailable, falls back to local TypeScript implementations.
 */

import { createChildLogger } from '../lib/logger';

const log = createChildLogger('goServiceBridge');

const GO_CORRIDOR_URL = process.env.GO_CORRIDOR_SERVICE_URL || 'http://localhost:8201';
const GO_SANCTIONS_URL = process.env.GO_SANCTIONS_SERVICE_URL || 'http://localhost:8202';
const GO_BILLING_URL = process.env.GO_BILLING_SERVICE_URL || 'http://localhost:8203';
const GO_MOJALOOP_URL = process.env.GO_MOJALOOP_SERVICE_URL || 'http://localhost:8204';
const RUST_LEDGER_URL = process.env.RUST_LEDGER_SERVICE_URL || 'http://localhost:8301';

interface ServiceResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  source: 'go_service' | 'local_fallback';
}

async function callService<T>(baseUrl: string, path: string, method: 'GET' | 'POST' = 'POST', body?: unknown): Promise<ServiceResponse<T>> {
  try {
    const opts: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    };
    if (body && method === 'POST') opts.body = JSON.stringify(body);
    
    const res = await fetch(`${baseUrl}${path}`, opts);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${await res.text().catch(() => '')}`, source: 'go_service' };
    }
    const data = await res.json() as T;
    return { ok: true, data, source: 'go_service' };
  } catch (error) {
    log.debug({ baseUrl, path, err: error }, 'Go service unavailable, using local fallback');
    return { ok: false, error: 'Service unavailable', source: 'local_fallback' };
  }
}

// ============================================================================
// CORRIDOR ROUTING
// ============================================================================

export interface CorridorQuoteRequest {
  corridor: string;
  amountNgn: string;
  destCurrency: string;
}

export interface CorridorQuoteResponse {
  corridor: string;
  rate: number;
  destAmount: number;
  destCurrency: string;
  provider: string;
  railType: string;
  railFee: number;
  corridorFee: number;
  totalFee: number;
  expiresAt: string;
}

// Fallback FX rates when Go service is unavailable
const FALLBACK_RATES: Record<string, number> = {
  'GHS': 0.00125000, 'XOF': 0.65789500, 'XAF': 0.65789500,
  'GBP': 0.00076920, 'USD': 0.00064516, 'CAD': 0.00092593,
  'INR': 0.08167235, 'TRY': 0.02160494, 'CNY': 0.01014714,
  'AED': 0.00237000, 'KES': 0.00925920, 'ZAR': 0.01019929,
};

const CORRIDOR_PROVIDERS: Record<string, string> = {
  'NG-GH': 'PAPSS', 'NG-SN': 'PAPSS', 'NG-CI': 'PAPSS', 'NG-CM': 'PAPSS',
  'NG-GB': 'SWIFT', 'NG-US': 'SWIFT', 'NG-CA': 'SWIFT',
  'NG-IN': 'UPI', 'NG-TR': 'SWIFT',
  'NG-CN': 'CIPS', 'NG-AE': 'SWIFT',
  'NG-KE': 'Mobile Money', 'NG-ZA': 'PAPSS',
};

export async function getCorridorQuote(req: CorridorQuoteRequest): Promise<ServiceResponse<CorridorQuoteResponse>> {
  const goResult = await callService<CorridorQuoteResponse>(GO_CORRIDOR_URL, '/api/quote', 'POST', req);
  if (goResult.ok) return goResult;
  
  // Local fallback
  const rate = FALLBACK_RATES[req.destCurrency] ?? 0.001;
  const destAmount = parseFloat(req.amountNgn) * rate;
  const corridorFee = parseFloat(req.amountNgn) * 0.005;
  
  return {
    ok: true,
    source: 'local_fallback',
    data: {
      corridor: req.corridor,
      rate,
      destAmount,
      destCurrency: req.destCurrency,
      provider: CORRIDOR_PROVIDERS[req.corridor] ?? 'Mojaloop Hub',
      railType: CORRIDOR_PROVIDERS[req.corridor] ?? 'MOJALOOP',
      railFee: corridorFee * 0.1,
      corridorFee,
      totalFee: corridorFee * 1.1,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    },
  };
}

export async function routeTransfer(corridor: string, amountNgn: string): Promise<ServiceResponse<{ provider: string; railType: string; estimatedSettlement: string }>> {
  const goResult = await callService<{ provider: string; railType: string; estimatedSettlement: string }>(
    GO_CORRIDOR_URL, '/api/route', 'POST', { corridor, amountNgn }
  );
  if (goResult.ok) return goResult;
  
  const provider = CORRIDOR_PROVIDERS[corridor] ?? 'Mojaloop Hub';
  return {
    ok: true,
    source: 'local_fallback',
    data: { provider, railType: provider, estimatedSettlement: '24h' },
  };
}

// ============================================================================
// SANCTIONS SCREENING
// ============================================================================

export interface SanctionsScreenRequest {
  transferId: string;
  senderName: string;
  senderBvn?: string;
  beneficiaryName: string;
  beneficiaryCountry?: string;
  corridor: string;
  amountUsd?: number;
}

export interface SanctionsScreenResponse {
  transferId: string;
  status: 'clear' | 'hit' | 'partial_match' | 'manual_review';
  score: number;
  decision: 'allow' | 'block' | 'escalate';
  reason: string;
  listsChecked: string[];
  matches: Array<{
    listId: string;
    matchedName: string;
    matchScore: number;
  }>;
}

export async function screenTransfer(req: SanctionsScreenRequest): Promise<ServiceResponse<SanctionsScreenResponse>> {
  const goResult = await callService<SanctionsScreenResponse>(GO_SANCTIONS_URL, '/api/screen', 'POST', req);
  if (goResult.ok) return goResult;
  
  // Local fallback — basic keyword screening
  const highRiskNames = ['hassan nasrallah', 'al-qaeda', 'isis', 'taliban', 'hezbollah'];
  const benefLower = req.beneficiaryName.toLowerCase();
  const isHit = highRiskNames.some(name => benefLower.includes(name));
  
  return {
    ok: true,
    source: 'local_fallback',
    data: {
      transferId: req.transferId,
      status: isHit ? 'hit' : 'clear',
      score: isHit ? 0.98 : 0.0,
      decision: isHit ? 'block' : 'allow',
      reason: isHit ? 'High-risk name match (local rules)' : 'No matches found (local rules)',
      listsChecked: ['LOCAL_RULES'],
      matches: isHit ? [{ listId: 'LOCAL', matchedName: req.beneficiaryName, matchScore: 0.98 }] : [],
    },
  };
}

// ============================================================================
// TIERED BILLING
// ============================================================================

export interface BillingCalculationRequest {
  participantId: number;
  tier: string;
  corridor: string;
  amountNgn: number;
}

export interface BillingCalculationResponse {
  platformFee: number;
  corridorFee: number;
  fxSpread: number;
  totalFee: number;
  cbnLevy: number;
  breakdown: Record<string, number>;
}

const TIER_RATES: Record<string, number> = {
  'starter': 0.007, 'growth': 0.005, 'enterprise': 0.003, 'premium': 0.002,
};

export async function calculateBilling(req: BillingCalculationRequest): Promise<ServiceResponse<BillingCalculationResponse>> {
  const goResult = await callService<BillingCalculationResponse>(GO_BILLING_URL, '/api/calculate', 'POST', req);
  if (goResult.ok) return goResult;
  
  // Local fallback
  const tierRate = TIER_RATES[req.tier] ?? 0.005;
  const platformFee = req.amountNgn * tierRate;
  const corridorFee = req.amountNgn * 0.001;
  const fxSpread = req.amountNgn * 0.0005;
  const cbnLevy = req.amountNgn * 0.0001;
  
  return {
    ok: true,
    source: 'local_fallback',
    data: {
      platformFee, corridorFee, fxSpread,
      totalFee: platformFee + corridorFee + fxSpread + cbnLevy,
      cbnLevy,
      breakdown: { platformFee, corridorFee, fxSpread, cbnLevy },
    },
  };
}

// ============================================================================
// MOJALOOP HUB
// ============================================================================

export async function lookupParty(partyIdType: string, partyId: string): Promise<ServiceResponse<{ name: string; dfspId: string; accountType: string }>> {
  const goResult = await callService<{ name: string; dfspId: string; accountType: string }>(
    GO_MOJALOOP_URL, '/api/parties/lookup', 'POST', { partyIdType, partyId }
  );
  if (goResult.ok) return goResult;
  
  return {
    ok: true,
    source: 'local_fallback',
    data: { name: 'Unknown', dfspId: 'dfsp-unknown', accountType: 'SAVINGS' },
  };
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

export async function checkServiceHealth(): Promise<Record<string, { available: boolean; latencyMs: number }>> {
  const services = [
    { name: 'corridor_routing', url: `${GO_CORRIDOR_URL}/health` },
    { name: 'sanctions_screening', url: `${GO_SANCTIONS_URL}/health` },
    { name: 'tiered_billing', url: `${GO_BILLING_URL}/health` },
    { name: 'mojaloop_hub', url: `${GO_MOJALOOP_URL}/health` },
    { name: 'rust_ledger', url: `${RUST_LEDGER_URL}/health` },
  ];
  
  const results: Record<string, { available: boolean; latencyMs: number }> = {};
  
  await Promise.all(services.map(async (svc) => {
    const start = Date.now();
    try {
      const res = await fetch(svc.url, { signal: AbortSignal.timeout(3_000) });
      results[svc.name] = { available: res.ok, latencyMs: Date.now() - start };
    } catch {
      results[svc.name] = { available: false, latencyMs: Date.now() - start };
    }
  }));
  
  return results;
}
