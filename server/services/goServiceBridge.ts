/**
 * Authoritative Go Service Bridge.
 *
 * Financial routing, sanctions, billing, and party lookup results are valid only
 * when returned by their designated service. This module intentionally does not
 * synthesize an apparently usable response when an upstream is unavailable.
 */

import { createChildLogger } from '../lib/logger';

const log = createChildLogger('goServiceBridge');

const GO_CORRIDOR_URL = process.env.GO_CORRIDOR_SERVICE_URL || 'http://localhost:8201';
const GO_SANCTIONS_URL = process.env.GO_SANCTIONS_SERVICE_URL || 'http://localhost:8202';
const GO_BILLING_URL = process.env.GO_BILLING_SERVICE_URL || 'http://localhost:8203';
const GO_MOJALOOP_URL = process.env.GO_MOJALOOP_SERVICE_URL || 'http://localhost:8204';
const RUST_LEDGER_URL = process.env.RUST_LEDGER_SERVICE_URL || 'http://localhost:8301';

export interface ServiceResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
  source: 'go_service' | 'unavailable';
}

async function callService<T>(
  baseUrl: string,
  path: string,
  method: 'GET' | 'POST' = 'POST',
  body?: unknown,
): Promise<ServiceResponse<T>> {
  try {
    const options: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    };
    if (body !== undefined && method === 'POST') options.body = JSON.stringify(body);

    const response = await fetch(`${baseUrl}${path}`, options);
    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      return {
        ok: false,
        error: `Authoritative service rejected ${path}: HTTP ${response.status}${responseText ? `: ${responseText}` : ''}`,
        source: 'go_service',
      };
    }
    return { ok: true, data: await response.json() as T, source: 'go_service' };
  } catch (error) {
    log.error({ baseUrl, path, err: error }, 'Authoritative Go service unavailable');
    return { ok: false, error: `Authoritative service unavailable for ${path}`, source: 'unavailable' };
  }
}

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

export function getCorridorQuote(req: CorridorQuoteRequest): Promise<ServiceResponse<CorridorQuoteResponse>> {
  return callService<CorridorQuoteResponse>(GO_CORRIDOR_URL, '/api/quote', 'POST', req);
}

export interface TransferRouteResponse {
  provider: string;
  railType: string;
  estimatedSettlement: string;
}

export function routeTransfer(corridor: string, amountNgn: string): Promise<ServiceResponse<TransferRouteResponse>> {
  return callService<TransferRouteResponse>(GO_CORRIDOR_URL, '/api/route', 'POST', { corridor, amountNgn });
}

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
  matches: Array<{ listId: string; matchedName: string; matchScore: number }>;
}

export function screenTransfer(req: SanctionsScreenRequest): Promise<ServiceResponse<SanctionsScreenResponse>> {
  return callService<SanctionsScreenResponse>(GO_SANCTIONS_URL, '/api/screen', 'POST', req);
}

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

export function calculateBilling(req: BillingCalculationRequest): Promise<ServiceResponse<BillingCalculationResponse>> {
  return callService<BillingCalculationResponse>(GO_BILLING_URL, '/api/calculate', 'POST', req);
}

export interface PartyLookupResponse {
  name: string;
  dfspId: string;
  accountType: string;
}

export function lookupParty(partyIdType: string, partyId: string): Promise<ServiceResponse<PartyLookupResponse>> {
  return callService<PartyLookupResponse>(GO_MOJALOOP_URL, '/api/parties/lookup', 'POST', { partyIdType, partyId });
}

export async function checkServiceHealth(): Promise<Record<string, { available: boolean; latencyMs: number }>> {
  const services = [
    { name: 'corridor_routing', url: `${GO_CORRIDOR_URL}/health` },
    { name: 'sanctions_screening', url: `${GO_SANCTIONS_URL}/health` },
    { name: 'tiered_billing', url: `${GO_BILLING_URL}/health` },
    { name: 'mojaloop_hub', url: `${GO_MOJALOOP_URL}/health` },
    { name: 'rust_ledger', url: `${RUST_LEDGER_URL}/health` },
  ];

  const results: Record<string, { available: boolean; latencyMs: number }> = {};
  await Promise.all(services.map(async (service) => {
    const started = Date.now();
    try {
      const response = await fetch(service.url, { signal: AbortSignal.timeout(3_000) });
      results[service.name] = { available: response.ok, latencyMs: Date.now() - started };
    } catch {
      results[service.name] = { available: false, latencyMs: Date.now() - started };
    }
  }));
  return results;
}
