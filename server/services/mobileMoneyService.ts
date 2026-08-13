import { createChildLogger } from '../lib/logger';
import { getDb } from '../db';
import { eq, desc } from 'drizzle-orm';
import { mobileMoneyTransfers } from '../../drizzle/payments-schema';

const log = createChildLogger('mobileMoney');
/**
 * Mobile Money Service
 * 
 * Integrates with mobile money providers (MTN MoMo, Airtel Money, Glo Cash)
 * Enables direct wallet-to-wallet transfers
 */

export interface MobileMoneyProvider {
  id: string;
  name: string;
  shortName: string;
  logo: string;
  minAmount: number;
  maxAmount: number;
  fee: number;
  countries: string[];
}

export interface MobileMoneyTransfer {
  reference: string;
  provider: string;
  recipientPhone: string;
  amount: number;
  fee: number;
  status: 'successful' | 'pending' | 'failed';
  message: string;
  transactionId?: string;
}

/**
 * Get supported mobile money providers
 */
export function getMobileMoneyProviders(): MobileMoneyProvider[] {
  return [
    {
      id: 'mtn_momo',
      name: 'MTN Mobile Money',
      shortName: 'MTN MoMo',
      logo: 'https://example.com/mtn-momo.png',
      minAmount: 100,
      maxAmount: 1000000,
      fee: 0,
      countries: ['NG', 'GH', 'UG', 'CM'],
    },
    {
      id: 'airtel_money',
      name: 'Airtel Money',
      shortName: 'Airtel Money',
      logo: 'https://example.com/airtel-money.png',
      minAmount: 100,
      maxAmount: 500000,
      fee: 0,
      countries: ['NG', 'KE', 'TZ', 'UG'],
    },
    {
      id: 'glo_cash',
      name: 'Glo Cash',
      shortName: 'Glo Cash',
      logo: 'https://example.com/glo-cash.png',
      minAmount: 100,
      maxAmount: 300000,
      fee: 0,
      countries: ['NG'],
    },
  ];
}

/**
 * Validate mobile money account
 */
export async function validateMobileMoneyAccount(params: {
  provider: string;
  phoneNumber: string;
}): Promise<{
  valid: boolean;
  accountName?: string;
  accountStatus?: string;
  error?: string;
}> {
  // Validate phone number format
  if (!validatePhoneNumber(params.phoneNumber, params.provider)) {
    return {
      valid: false,
      error: 'Invalid phone number format',
    };
  }

  log.info(params, '[Mobile Money] Validating account');

  const providerApiUrls: Record<string, string | undefined> = {
    mtn_momo: process.env.MTN_MOMO_API_URL,
    airtel_money: process.env.AIRTEL_MONEY_API_URL,
    glo_cash: process.env.GLO_CASH_API_URL,
  };
  const apiUrl = providerApiUrls[params.provider];
  const apiKey = process.env.MOBILE_MONEY_API_KEY;

  if (apiUrl && apiKey) {
    try {
      const response = await fetch(`${apiUrl}/accountholder/${params.phoneNumber}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (response.ok) {
        const data = await response.json() as { accountName?: string; status?: string };
        return { valid: true, accountName: data.accountName, accountStatus: data.status || 'active' };
      }
      return { valid: false, error: `Provider returned ${response.status}` };
    } catch (err) {
      log.error({ err, provider: params.provider }, '[Mobile Money] Provider account validation failed');
      return { valid: false, error: 'Provider account validation is unavailable' };
    }
  }

  return {
    valid: false,
    error: `Mobile money provider ${params.provider} is not configured`,
  };
}

/**
 * Send money to mobile money wallet
 */
export async function sendMobileMoneyTransfer(params: {
  remittanceId: string;
  provider: string;
  recipientPhone: string;
  amount: number;
  narration?: string;
}): Promise<MobileMoneyTransfer> {
  // Generate reference
  const { randomBytes } = require('crypto');
  const reference = `MOMO_${Date.now()}_${randomBytes(5).toString('hex')}`;

  // Validate amount limits
  const providerInfo = getMobileMoneyProviders().find(p => p.id === params.provider);
  if (!providerInfo) {
    throw new Error('Unsupported mobile money provider');
  }

  if (params.amount < providerInfo.minAmount || params.amount > providerInfo.maxAmount) {
    throw new Error(`Amount must be between ₦${providerInfo.minAmount} and ₦${providerInfo.maxAmount}`);
  }

  log.info(params, '[Mobile Money] Sending transfer');

  const providerApiUrls: Record<string, string | undefined> = {
    mtn_momo: process.env.MTN_MOMO_API_URL,
    airtel_money: process.env.AIRTEL_MONEY_API_URL,
    glo_cash: process.env.GLO_CASH_API_URL,
  };
  const apiUrl = providerApiUrls[params.provider];
  const apiKey = process.env.MOBILE_MONEY_API_KEY;
  const db = await getDb();
  if (!db) {
    throw new Error('Mobile money transfer persistence is unavailable');
  }
  if (!apiUrl || !apiKey) {
    throw new Error(`Mobile money provider ${params.provider} is not configured`);
  }

  const fee = calculateMobileMoneyFee(params.amount, params.provider);
  const result: MobileMoneyTransfer = {
    reference,
    provider: params.provider,
    recipientPhone: params.recipientPhone,
    amount: params.amount,
    fee,
    status: 'pending',
    message: 'Processing transfer',
    transactionId: undefined,
  };

  try {
    const response = await fetch(`${apiUrl}/transfers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        reference,
        recipientPhone: params.recipientPhone,
        amount: params.amount,
        narration: params.narration,
      }),
    });
    if (!response.ok) {
      throw new Error(`Provider rejected transfer with HTTP ${response.status}`);
    }
    const data = await response.json() as { status?: string; transactionId?: string; message?: string };
    result.status = data.status === 'successful' ? 'successful' : data.status === 'failed' ? 'failed' : 'pending';
    result.transactionId = data.transactionId;
    result.message = data.message || result.message;
  } catch (err) {
    log.error({ err, provider: params.provider, reference }, '[Mobile Money] Provider transfer failed');
    result.status = 'failed';
    result.message = 'Provider communication failed';
  }

  try {
    await db.insert(mobileMoneyTransfers).values({
      id: reference,
      remittanceId: params.remittanceId,
      reference,
      provider: params.provider,
      recipientPhone: params.recipientPhone,
      amount: String(params.amount),
      fee: String(fee),
      status: result.status,
      transactionId: result.transactionId,
    });
  } catch (err) {
    log.error({ err, reference }, '[Mobile Money] DB persist error');
    throw new Error('Mobile money transfer result could not be persisted');
  }

  return result;
}

/**
 * Get mobile money transfer status
 */
export async function getMobileMoneyTransferStatus(reference: string): Promise<{
  reference: string;
  status: 'successful' | 'pending' | 'failed';
  message: string;
  transactionId?: string;
}> {
  const db = await getDb();
  if (db) {
    try {
      const rows = await db.select().from(mobileMoneyTransfers).where(eq(mobileMoneyTransfers.reference, reference)).limit(1);
      if (rows.length > 0) {
        return {
          reference,
          status: rows[0].status as 'successful' | 'pending' | 'failed',
          message: `Transfer ${rows[0].status}`,
          transactionId: rows[0].transactionId || undefined,
        };
      }
    } catch (err) {
      log.error({ err }, '[Mobile Money] DB query error');
    }
  }
  throw new Error(`Mobile money transfer status is unavailable for ${reference}`);
}

/**
 * Calculate mobile money transfer fee
 */
function calculateMobileMoneyFee(amount: number, provider: string): number {
  // Fee structure by provider
  const feeStructure: Record<string, { percentage: number; min: number; max: number }> = {
    mtn_momo: { percentage: 0, min: 0, max: 0 }, // Free transfers
    airtel_money: { percentage: 0, min: 0, max: 0 }, // Free transfers
    glo_cash: { percentage: 0, min: 0, max: 0 }, // Free transfers
  };

  const config = feeStructure[provider] || { percentage: 0, min: 0, max: 0 };
  const calculatedFee = amount * (config.percentage / 100);

  return Math.max(config.min, Math.min(calculatedFee, config.max));
}

/**
 * Validate phone number format by provider
 */
function validatePhoneNumber(phoneNumber: string, provider: string): boolean {
  // Remove spaces and dashes
  const cleaned = phoneNumber.replace(/[\s-]/g, '');

  // Provider-specific prefixes
  const providerPrefixes: Record<string, string[]> = {
    mtn_momo: ['0803', '0806', '0810', '0813', '0814', '0816', '0903', '0906', '0913', '0916'],
    airtel_money: ['0802', '0808', '0812', '0901', '0902', '0904', '0907', '0912'],
    glo_cash: ['0805', '0807', '0811', '0815', '0905', '0915'],
  };

  const prefixes = providerPrefixes[provider];
  if (!prefixes) return false;

  return prefixes.some(prefix => cleaned.startsWith(prefix)) && cleaned.length === 11;
}

/**
 * Get provider from phone number
 */
export function detectProviderFromPhone(phoneNumber: string): string | null {
  const cleaned = phoneNumber.replace(/[\s-]/g, '');

  const providers = getMobileMoneyProviders();
  for (const provider of providers) {
    if (validatePhoneNumber(cleaned, provider.id)) {
      return provider.id;
    }
  }

  return null;
}

/**
 * Send mobile money receipt via SMS
 */
export async function sendMobileMoneyReceipt(params: {
  recipientPhone: string;
  provider: string;
  amount: number;
  reference: string;
  transactionId?: string;
}): Promise<boolean> {
  const providerInfo = getMobileMoneyProviders().find(p => p.id === params.provider);
  const message = `You have received ₦${params.amount.toLocaleString()} in your ${providerInfo?.shortName} wallet. Ref: ${params.reference}${params.transactionId ? `. TxnID: ${params.transactionId}` : ''}`;

  const smsApiUrl = process.env.SMS_API_URL;
  const smsApiKey = process.env.SMS_API_KEY;
  if (smsApiUrl && smsApiKey) {
    try {
      await fetch(smsApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${smsApiKey}` },
        body: JSON.stringify({ to: params.recipientPhone, message }),
      });
      return true;
    } catch (err) {
      log.error({ err }, '[SMS] Send failed');
      return false;
    }
  }
  log.error({ provider: params.provider, reference: params.reference }, '[SMS] Provider is not configured');
  return false;
}

/**
 * Check mobile money account balance (for debugging)
 */
export async function checkMobileMoneyBalance(params: {
  provider: string;
  phoneNumber: string;
}): Promise<{
  balance: number;
  currency: string;
}> {
  const providerApiUrls: Record<string, string | undefined> = {
    mtn_momo: process.env.MTN_MOMO_API_URL,
    airtel_money: process.env.AIRTEL_MONEY_API_URL,
    glo_cash: process.env.GLO_CASH_API_URL,
  };
  const apiUrl = providerApiUrls[params.provider];
  const apiKey = process.env.MOBILE_MONEY_API_KEY;
  if (apiUrl && apiKey) {
    try {
      const response = await fetch(`${apiUrl}/balance/${params.phoneNumber}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (response.ok) {
        const data = await response.json() as { balance: number; currency: string };
        return data;
      }
    } catch (err) {
      log.error({ err }, '[Mobile Money] Balance check error');
    }
  }
  throw new Error(`Mobile money balance is unavailable for provider ${params.provider}`);
}

/**
 * Get mobile money transaction history
 */
export async function getMobileMoneyHistory(params: {
  remittanceId?: string;
  provider?: string;
  limit?: number;
}): Promise<Array<{
  reference: string;
  provider: string;
  recipientPhone: string;
  amount: number;
  status: string;
  createdAt: Date;
}>> {
  const db = await getDb();
  if (db) {
    try {
      const rows = await db.select().from(mobileMoneyTransfers).orderBy(desc(mobileMoneyTransfers.createdAt)).limit(params.limit || 50);
      return rows.map(r => ({
        reference: r.reference,
        provider: r.provider,
        recipientPhone: r.recipientPhone,
        amount: Number(r.amount),
        status: r.status,
        createdAt: r.createdAt,
      }));
    } catch (err) {
      log.error({ err }, '[Mobile Money] DB history error');
    }
  }
  throw new Error('Mobile money transfer history is unavailable');
}

/**
 * Reverse mobile money transfer (for failed remittances)
 */
export async function reverseMobileMoneyTransfer(reference: string): Promise<{
  success: boolean;
  reversalReference?: string;
  message: string;
}> {
  const db = await getDb();
  if (!db) throw new Error('Mobile money reversal persistence is unavailable');
  const rows = await db.select().from(mobileMoneyTransfers).where(eq(mobileMoneyTransfers.reference, reference)).limit(1);
  const transfer = rows[0];
  if (!transfer) throw new Error(`Mobile money transfer ${reference} was not found`);

  const providerUrls: Record<string, string | undefined> = {
    mtn_momo: process.env.MTN_MOMO_API_URL,
    airtel_money: process.env.AIRTEL_MONEY_API_URL,
    glo_cash: process.env.GLO_CASH_API_URL,
  };
  const apiUrl = providerUrls[transfer.provider];
  const apiKey = process.env.MOBILE_MONEY_API_KEY;
  if (!apiUrl || !apiKey) throw new Error(`Mobile money reversal provider ${transfer.provider} is not configured`);

  const response = await fetch(`${apiUrl}/transfers/${encodeURIComponent(reference)}/reversal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Mobile money reversal was rejected with HTTP ${response.status}`);
  const body = await response.json() as { reversalReference?: string; message?: string; status?: string };
  if (body.status === 'failed') throw new Error(body.message || 'Mobile money provider rejected the reversal');

  await db.update(mobileMoneyTransfers).set({ status: 'failed' }).where(eq(mobileMoneyTransfers.reference, reference));
  return {
    success: true,
    reversalReference: body.reversalReference,
    message: body.message || 'Provider-confirmed reversal submitted',
  };
}

/**
 * Get mobile money provider limits
 */
export function getProviderLimits(provider: string): {
  minAmount: number;
  maxAmount: number;
  dailyLimit: number;
  monthlyLimit: number;
} {
  const limits: Record<string, any> = {
    mtn_momo: {
      minAmount: 100,
      maxAmount: 1000000,
      dailyLimit: 5000000,
      monthlyLimit: 20000000,
    },
    airtel_money: {
      minAmount: 100,
      maxAmount: 500000,
      dailyLimit: 2000000,
      monthlyLimit: 10000000,
    },
    glo_cash: {
      minAmount: 100,
      maxAmount: 300000,
      dailyLimit: 1000000,
      monthlyLimit: 5000000,
    },
  };

  return limits[provider] || {
    minAmount: 100,
    maxAmount: 100000,
    dailyLimit: 500000,
    monthlyLimit: 2000000,
  };
}
