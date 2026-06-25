/**
 * Exchange Rate Service
 * 
 * Aggregates exchange rates from multiple providers and caches them
 * Supports crypto-to-crypto and crypto-to-fiat conversions
 */

import { getExchangeRateQuote as getCoinbaseRate } from './coinbaseService';
import { getUSDCExchangeRate as getCircleRate } from './circleService';

interface CachedRate {
  rate: number;
  bidRate?: number;
  askRate?: number;
  provider: string;
  timestamp: Date;
  expiresAt: Date;
}

// In-memory cache for exchange rates (5 minute TTL)
const rateCache = new Map<string, CachedRate>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get exchange rate with caching
 */
export async function getExchangeRate(params: {
  fromCurrency: string;
  toCurrency: string;
  amount: number;
  provider?: 'coinbase' | 'circle' | 'auto';
}): Promise<{
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  bidRate?: number;
  askRate?: number;
  amount: number;
  convertedAmount: number;
  fee: number;
  totalCost: number;
  provider: string;
  expiresAt: Date;
}> {
  const cacheKey = `${params.fromCurrency}-${params.toCurrency}`;
  const cached = rateCache.get(cacheKey);

  // Return cached rate if still valid
  if (cached && cached.expiresAt > new Date()) {
    const convertedAmount = params.amount * cached.rate;
    const fee = params.amount * 0.01; // 1% default fee
    
    return {
      fromCurrency: params.fromCurrency,
      toCurrency: params.toCurrency,
      rate: cached.rate,
      bidRate: cached.bidRate,
      askRate: cached.askRate,
      amount: params.amount,
      convertedAmount,
      fee,
      totalCost: params.amount + fee,
      provider: cached.provider,
      expiresAt: cached.expiresAt,
    };
  }

  // Determine which provider to use
  let provider = params.provider || 'auto';
  
  if (provider === 'auto') {
    // Use Circle for USDC, Coinbase for everything else
    provider = params.fromCurrency === 'USDC' ? 'circle' : 'coinbase';
  }

  // Fetch fresh rate from provider
  let quote;
  
  if (provider === 'circle' && params.fromCurrency === 'USDC') {
    const circleQuote = await getCircleRate({
      fromCurrency: params.fromCurrency,
      toCurrency: params.toCurrency,
      amount: params.amount,
    });
    
    quote = {
      fromCurrency: params.fromCurrency,
      toCurrency: params.toCurrency,
      rate: circleQuote.rate,
      amount: circleQuote.amount,
      convertedAmount: circleQuote.convertedAmount,
      fee: circleQuote.fee,
      totalCost: circleQuote.totalCost,
      provider: 'circle',
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
    };
  } else {
    const coinbaseQuote = await getCoinbaseRate({
      fromCurrency: params.fromCurrency,
      toCurrency: params.toCurrency,
      amount: params.amount,
    });
    
    quote = {
      fromCurrency: params.fromCurrency,
      toCurrency: params.toCurrency,
      rate: coinbaseQuote.rate,
      amount: coinbaseQuote.amount,
      convertedAmount: coinbaseQuote.convertedAmount,
      fee: coinbaseQuote.fee,
      totalCost: coinbaseQuote.totalCost,
      provider: 'coinbase',
      expiresAt: coinbaseQuote.expiresAt,
    };
  }

  // Cache the rate
  rateCache.set(cacheKey, {
    rate: quote.rate,
    provider: quote.provider,
    timestamp: new Date(),
    expiresAt: quote.expiresAt,
  });

  return quote;
}

/**
 * Get multiple exchange rates at once
 */
export async function getMultipleExchangeRates(params: {
  fromCurrency: string;
  toCurrencies: string[];
  amount: number;
}): Promise<Array<{
  fromCurrency: string;
  toCurrency: string;
  rate: number;
  convertedAmount: number;
  provider: string;
}>> {
  const promises = params.toCurrencies.map(toCurrency =>
    getExchangeRate({
      fromCurrency: params.fromCurrency,
      toCurrency,
      amount: params.amount,
    })
  );

  const results = await Promise.all(promises);
  
  return results.map(result => ({
    fromCurrency: result.fromCurrency,
    toCurrency: result.toCurrency,
    rate: result.rate,
    convertedAmount: result.convertedAmount,
    provider: result.provider,
  }));
}

/**
 * Calculate conversion with fees
 */
export function calculateConversion(params: {
  amount: number;
  rate: number;
  platformFeePercent?: number;
  exchangeFeePercent?: number;
}): {
  inputAmount: number;
  exchangeRate: number;
  exchangeFee: number;
  platformFee: number;
  totalFees: number;
  outputAmount: number;
  effectiveRate: number;
} {
  const platformFeePercent = params.platformFeePercent || 0.5; // 0.5% default
  const exchangeFeePercent = params.exchangeFeePercent || 1.0; // 1.0% default

  const exchangeFee = params.amount * (exchangeFeePercent / 100);
  const platformFee = params.amount * (platformFeePercent / 100);
  const totalFees = exchangeFee + platformFee;
  
  const amountAfterFees = params.amount - totalFees;
  const outputAmount = amountAfterFees * params.rate;
  const effectiveRate = outputAmount / params.amount;

  return {
    inputAmount: params.amount,
    exchangeRate: params.rate,
    exchangeFee,
    platformFee,
    totalFees,
    outputAmount,
    effectiveRate,
  };
}

/**
 * Get historical exchange rates
 */
export async function getHistoricalRates(params: {
  fromCurrency: string;
  toCurrency: string;
  startDate: Date;
  endDate: Date;
}): Promise<Array<{
  date: Date;
  rate: number;
  provider: string;
}>> {
  // Query PostgreSQL for historical rate data
  const { getDb } = await import('../db');
  const db = await getDb();
  if (db) {
    try {
      const { sql } = await import('drizzle-orm');
      const rows = await db.execute(
        sql`SELECT created_at, rate, provider FROM exchange_rate_history
            WHERE from_currency = ${params.fromCurrency}
            AND to_currency = ${params.toCurrency}
            AND created_at BETWEEN ${params.startDate} AND ${params.endDate}
            ORDER BY created_at ASC`
      );
      if (Array.isArray(rows) && rows.length > 0) {
        return rows.map((r: Record<string, unknown>) => ({
          date: new Date(r.created_at as string),
          rate: Number(r.rate),
          provider: String(r.provider),
        }));
      }
    } catch {
      // Table may not exist yet
    }
  }
  return [];
}

/**
 * Clear rate cache
 */
export function clearRateCache(): void {
  rateCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  size: number;
  entries: Array<{
    pair: string;
    rate: number;
    provider: string;
    age: number;
    expiresIn: number;
  }>;
} {
  const now = new Date();
  const entries = Array.from(rateCache.entries()).map(([pair, cached]) => ({
    pair,
    rate: cached.rate,
    provider: cached.provider,
    age: now.getTime() - cached.timestamp.getTime(),
    expiresIn: cached.expiresAt.getTime() - now.getTime(),
  }));

  return {
    size: rateCache.size,
    entries,
  };
}

/**
 * Supported currency pairs
 */
export function getSupportedPairs(): Array<{
  from: string;
  to: string;
  provider: string;
}> {
  return [
    // Crypto to fiat
    { from: 'BTC', to: 'USD', provider: 'coinbase' },
    { from: 'BTC', to: 'NGN', provider: 'coinbase' },
    { from: 'ETH', to: 'USD', provider: 'coinbase' },
    { from: 'ETH', to: 'NGN', provider: 'coinbase' },
    { from: 'USDC', to: 'USD', provider: 'circle' },
    { from: 'USDC', to: 'NGN', provider: 'circle' },
    { from: 'USDT', to: 'USD', provider: 'coinbase' },
    { from: 'USDT', to: 'NGN', provider: 'coinbase' },
    
    // Crypto to crypto
    { from: 'BTC', to: 'ETH', provider: 'coinbase' },
    { from: 'ETH', to: 'BTC', provider: 'coinbase' },
    { from: 'BTC', to: 'USDC', provider: 'coinbase' },
    { from: 'ETH', to: 'USDC', provider: 'coinbase' },
  ];
}

/**
 * Check if a currency pair is supported
 */
export function isPairSupported(fromCurrency: string, toCurrency: string): boolean {
  return getSupportedPairs().some(
    pair => pair.from === fromCurrency && pair.to === toCurrency
  );
}

/**
 * Get best rate from multiple providers
 */
export async function getBestRate(params: {
  fromCurrency: string;
  toCurrency: string;
  amount: number;
}): Promise<{
  provider: string;
  rate: number;
  convertedAmount: number;
  fee: number;
  totalCost: number;
}> {
  // Get rates from all providers
  const providers: Array<'coinbase' | 'circle'> = ['coinbase', 'circle'];
  const rates = await Promise.allSettled(
    providers.map(provider =>
      getExchangeRate({
        ...params,
        provider,
      })
    )
  );

  // Filter successful results
  const successfulRates = rates
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof getExchangeRate>>> => 
      result.status === 'fulfilled'
    )
    .map(result => result.value);

  if (successfulRates.length === 0) {
    throw new Error('No providers available for this currency pair');
  }

  // Find the best rate (highest converted amount after fees)
  const best = successfulRates.reduce((prev, current) =>
    current.convertedAmount > prev.convertedAmount ? current : prev
  );

  return {
    provider: best.provider,
    rate: best.rate,
    convertedAmount: best.convertedAmount,
    fee: best.fee,
    totalCost: best.totalCost,
  };
}
