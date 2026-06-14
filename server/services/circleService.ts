import { createChildLogger } from '../lib/logger';

const log = createChildLogger('circleService');

/**
 * Circle USDC Integration Service
 * 
 * Handles USDC payment processing and conversion via Circle API
 * Specialized for USDC stablecoin transactions
 */

import crypto from 'crypto';

// Circle API configuration
const CIRCLE_API_URL = process.env.CIRCLE_API_URL || 'https://api.circle.com/v1';
const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY || '';

export interface CirclePayment {
  id: string;
  type: 'payment';
  merchantId: string;
  merchantWalletId: string;
  amount: {
    amount: string;
    currency: string;
  };
  source: {
    type: 'blockchain';
    chain: 'ETH' | 'ALGO' | 'TRX';
    address?: string;
  };
  description: string;
  status: 'pending' | 'confirmed' | 'paid' | 'failed';
  captured: boolean;
  createDate: string;
  updateDate: string;
  metadata: Record<string, any>;
}

export interface CircleTransfer {
  id: string;
  source: {
    type: 'wallet';
    id: string;
  };
  destination: {
    type: 'blockchain' | 'wallet' | 'wire';
    address?: string;
    chain?: string;
    id?: string;
  };
  amount: {
    amount: string;
    currency: string;
  };
  status: 'pending' | 'complete' | 'failed';
  createDate: string;
}

export interface CircleWallet {
  walletId: string;
  entityId: string;
  type: 'end_user_wallet' | 'merchant';
  description: string;
  balances: Array<{
    amount: string;
    currency: string;
  }>;
}

/**
 * Create a payment intent for USDC
 */
export async function createUSDCPayment(params: {
  remittanceId: string;
  amount: number;
  currency: string; // USDC
  chain?: 'ETH' | 'ALGO' | 'TRX';
  description: string;
  metadata?: Record<string, any>;
}): Promise<CirclePayment> {
  const idempotencyKey = crypto.randomUUID();
  
  const response = await fetch(`${CIRCLE_API_URL}/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CIRCLE_API_KEY}`,
    },
    body: JSON.stringify({
      idempotencyKey,
      amount: {
        amount: params.amount.toFixed(2),
        currency: params.currency,
      },
      source: {
        type: 'blockchain',
        chain: params.chain || 'ETH',
      },
      description: params.description,
      metadata: {
        remittanceId: params.remittanceId,
        ...params.metadata,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Circle API error: ${error.message || response.statusText}`);
  }

  const data = await response.json();
  return data.data as CirclePayment;
}

/**
 * Get payment status
 */
export async function getUSDCPaymentStatus(paymentId: string): Promise<{
  paymentId: string;
  status: 'pending' | 'confirmed' | 'paid' | 'failed';
  amount?: string;
  currency?: string;
  transactionHash?: string;
  chain?: string;
}> {
  const response = await fetch(`${CIRCLE_API_URL}/payments/${paymentId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${CIRCLE_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get payment status: ${response.statusText}`);
  }

  const data = await response.json();
  const payment = data.data as CirclePayment;

  return {
    paymentId: payment.id,
    status: payment.status,
    amount: payment.amount.amount,
    currency: payment.amount.currency,
    transactionHash: payment.source.address,
    chain: payment.source.chain,
  };
}

/**
 * Convert USDC to fiat (via Circle's payout API)
 */
export async function convertUSDCToFiat(params: {
  amount: number;
  currency: string; // USD, EUR, etc.
  remittanceId: string;
  bankAccount?: {
    accountNumber: string;
    routingNumber: string;
    bankName: string;
  };
}): Promise<{
  transferId: string;
  status: 'pending' | 'complete' | 'failed';
  estimatedCompletionTime: Date;
}> {
  const idempotencyKey = crypto.randomUUID();

  const response = await fetch(`${CIRCLE_API_URL}/transfers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CIRCLE_API_KEY}`,
    },
    body: JSON.stringify({
      idempotencyKey,
      source: {
        type: 'wallet',
        id: process.env.CIRCLE_MERCHANT_WALLET_ID,
      },
      destination: {
        type: 'wire',
        ...params.bankAccount,
      },
      amount: {
        amount: params.amount.toFixed(2),
        currency: params.currency,
      },
      metadata: {
        remittanceId: params.remittanceId,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Circle transfer error: ${error.message || response.statusText}`);
  }

  const data = await response.json();
  const transfer = data.data as CircleTransfer;

  // Circle wire transfers typically complete in 1-3 business days
  const estimatedCompletionTime = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  return {
    transferId: transfer.id,
    status: transfer.status,
    estimatedCompletionTime,
  };
}

/**
 * Get transfer status
 */
export async function getTransferStatus(transferId: string): Promise<{
  transferId: string;
  status: 'pending' | 'complete' | 'failed';
  amount?: string;
  currency?: string;
  completedAt?: Date;
}> {
  const response = await fetch(`${CIRCLE_API_URL}/transfers/${transferId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${CIRCLE_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get transfer status: ${response.statusText}`);
  }

  const data = await response.json();
  const transfer = data.data as CircleTransfer;

  return {
    transferId: transfer.id,
    status: transfer.status,
    amount: transfer.amount.amount,
    currency: transfer.amount.currency,
    completedAt: transfer.status === 'complete' ? new Date(transfer.createDate) : undefined,
  };
}

/**
 * Get USDC to fiat exchange rate
 */
export async function getUSDCExchangeRate(params: {
  fromCurrency: string; // USDC
  toCurrency: string; // USD, EUR, NGN, etc.
  amount: number;
}): Promise<{
  rate: number;
  amount: number;
  convertedAmount: number;
  fee: number;
  totalCost: number;
}> {
  // For USDC, the rate to USD is always 1:1
  if (params.toCurrency === 'USD') {
    const fee = params.amount * 0.001; // 0.1% fee
    return {
      rate: 1.0,
      amount: params.amount,
      convertedAmount: params.amount,
      fee,
      totalCost: params.amount + fee,
    };
  }

  // For other currencies, we need to get the exchange rate
  // In production, this would call a forex API
  // For now, we'll use a simplified approach
  const forexRates: Record<string, number> = {
    NGN: 1650, // 1 USD = 1650 NGN (example rate)
    EUR: 0.92, // 1 USD = 0.92 EUR
    GBP: 0.79, // 1 USD = 0.79 GBP
  };

  const rate = forexRates[params.toCurrency] || 1.0;
  const convertedAmount = params.amount * rate;
  const fee = params.amount * 0.001; // 0.1% fee
  const totalCost = params.amount + fee;

  return {
    rate,
    amount: params.amount,
    convertedAmount,
    fee,
    totalCost,
  };
}

/**
 * Create a wallet for a user
 */
export async function createUserWallet(params: {
  userId: string;
  description: string;
}): Promise<CircleWallet> {
  const idempotencyKey = crypto.randomUUID();

  const response = await fetch(`${CIRCLE_API_URL}/wallets`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CIRCLE_API_KEY}`,
    },
    body: JSON.stringify({
      idempotencyKey,
      description: params.description,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Circle wallet creation error: ${error.message || response.statusText}`);
  }

  const data = await response.json();
  return data.data as CircleWallet;
}

/**
 * Get wallet balance
 */
export async function getWalletBalance(walletId: string): Promise<{
  walletId: string;
  balances: Array<{
    amount: string;
    currency: string;
  }>;
}> {
  const response = await fetch(`${CIRCLE_API_URL}/wallets/${walletId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${CIRCLE_API_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get wallet balance: ${response.statusText}`);
  }

  const data = await response.json();
  const wallet = data.data as CircleWallet;

  return {
    walletId: wallet.walletId,
    balances: wallet.balances,
  };
}

/**
 * Generate a blockchain address for receiving USDC
 */
export async function generateDepositAddress(params: {
  walletId: string;
  chain: 'ETH' | 'ALGO' | 'TRX';
  currency: string; // USDC
}): Promise<{
  address: string;
  chain: string;
  currency: string;
}> {
  const idempotencyKey = crypto.randomUUID();

  const response = await fetch(`${CIRCLE_API_URL}/wallets/${params.walletId}/addresses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CIRCLE_API_KEY}`,
    },
    body: JSON.stringify({
      idempotencyKey,
      currency: params.currency,
      chain: params.chain,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Circle address generation error: ${error.message || response.statusText}`);
  }

  const data = await response.json();
  
  return {
    address: data.data.address,
    chain: data.data.chain,
    currency: data.data.currency,
  };
}

/**
 * Verify Circle webhook signature
 */
export function verifyCircleWebhook(
  payload: string,
  signature: string
): boolean {
  const crypto = require('crypto');
  const secret = process.env.CIRCLE_WEBHOOK_SECRET;
  if (!secret) {
    log.warn('CIRCLE_WEBHOOK_SECRET not configured, skipping verification');
    return false;
  }
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature),
  );
}

/**
 * Handle Circle webhook event
 */
export async function handleCircleWebhook(event: {
  type: string;
  data: CirclePayment | CircleTransfer;
}): Promise<{
  remittanceId?: string;
  status: string;
  shouldUpdateRemittance: boolean;
}> {
  const metadata = 'metadata' in event.data ? event.data.metadata : {};
  const remittanceId = metadata.remittanceId;

  // Map Circle event types to remittance statuses
  const statusMap: Record<string, string> = {
    'payment.created': 'usdc_pending',
    'payment.confirmed': 'usdc_confirmed',
    'payment.paid': 'usdc_paid',
    'payment.failed': 'usdc_failed',
    'transfer.created': 'transfer_pending',
    'transfer.complete': 'transfer_completed',
    'transfer.failed': 'transfer_failed',
  };

  const status = statusMap[event.type] || 'unknown';
  const shouldUpdateRemittance = status !== 'unknown' && !!remittanceId;

  return {
    remittanceId,
    status,
    shouldUpdateRemittance,
  };
}
