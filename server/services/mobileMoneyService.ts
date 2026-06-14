import { createChildLogger } from '../lib/logger';

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

  // Simulate provider-specific account validation
  // In production, this calls the provider's name-enquiry API (e.g., MTN MoMo API /v1_0/accountholder)
  const phoneDigits = params.phoneNumber.replace(/\D/g, '');
  const lastFour = phoneDigits.slice(-4);

  // Nigerian mobile money accounts are linked to BVN-verified identities
  const providerNames: Record<string, string[]> = {
    mtn_momo: ['Adebayo Ogundimu', 'Chioma Nwosu', 'Emeka Ibe', 'Fatima Bello', 'Gbenga Adeola'],
    airtel_money: ['Ibrahim Musa', 'Jumoke Adeyemi', 'Kelechi Okoro', 'Lola Akinwunmi', 'Musa Abdullahi'],
    glo_cash: ['Ngozi Obi', 'Oluwaseun Bakare', 'Precious Eze', 'Rasheed Adegoke', 'Shade Olowookere'],
  };
  const names = providerNames[params.provider] || providerNames.mtn_momo;
  const nameIndex = parseInt(lastFour, 10) % names.length;

  return {
    valid: true,
    accountName: names[nameIndex],
    accountStatus: 'active',
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

  // Simulate provider API call — in production, uses provider-specific SDK
  // MTN MoMo: POST /collection/v1_0/requesttopay
  // Airtel Money: POST /merchant/v1/payments
  const result: MobileMoneyTransfer = {
    reference,
    provider: params.provider,
    recipientPhone: params.recipientPhone,
    amount: params.amount,
    fee: calculateMobileMoneyFee(params.amount, params.provider),
    status: 'successful',
    message: 'Transfer successful',
    transactionId: `TXN${Date.now()}`,
  };

  // Store in database
  // await db.createMobileMoneyTransfer({
  //   remittanceId: params.remittanceId,
  //   reference: result.reference,
  //   provider: params.provider,
  //   recipientPhone: params.recipientPhone,
  //   amount: params.amount,
  //   fee: result.fee,
  //   status: result.status,
  //   transactionId: result.transactionId,
  // });

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
  // In production, query provider API
  return {
    reference,
    status: 'successful',
    message: 'Transfer completed',
    transactionId: `TXN${Date.now()}`,
  };
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

  // In production, send via SMS provider
  log.info(`[SMS] Sending to ${params.recipientPhone}: ${message}`);

  return true;
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
  // In production, call provider API
  // This requires special permissions and is typically not available
  
  return {
    balance: 0,
    currency: 'NGN',
  };
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
  // In production, fetch from database
  return [];
}

/**
 * Reverse mobile money transfer (for failed remittances)
 */
export async function reverseMobileMoneyTransfer(reference: string): Promise<{
  success: boolean;
  reversalReference?: string;
  message: string;
}> {
  // In production, call provider API for reversal
  log.info({ reference }, '[Mobile Money] Reversing transfer');

  return {
    success: true,
    reversalReference: `REV_${reference}`,
    message: 'Transfer reversed successfully',
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
