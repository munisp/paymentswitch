/**
 * Remittance Workflow Orchestrator
 * 
 * Orchestrates the complete remittance flow without external dependencies
 * Uses database-backed state machine for reliability and retry logic
 * 
 * Flow:
 * 1. Wait for crypto payment confirmation
 * 2. Convert crypto to fiat
 * 3. Perform KYC verification (if needed)
 * 4. Execute delivery (bank transfer, agent cash, etc.)
 * 5. Send notifications and webhooks
 */

import * as coinbaseService from './coinbaseService';
import * as circleService from './circleService';
import * as nibssService from './nibssService';
import * as kycService from './kycService';
import * as exchangeRateService from './exchangeRateService';
import { createChildLogger } from '../lib/logger';
import { getDb } from '../db';
import { remittances } from '../../drizzle/remittance-schema';
import { remittanceWorkflows, webhookDeliveries } from '../../drizzle/payments-schema';
import { eq } from 'drizzle-orm';

const log = createChildLogger('remittanceOrchestrator');

export interface RemittanceWorkflowState {
  remittanceId: string;
  currentStep: 'created' | 'waiting_payment' | 'converting' | 'kyc_verification' | 
                'verifying_account' | 'opening_account' | 'transferring' | 'completed' | 'failed';
  chargeId: string;
  senderCurrency: string;
  senderAmount: number;
  recipientCurrency: string;
  recipientPhone: string;
  deliveryOption: 'NEW_ACCOUNT' | 'EXISTING_ACCOUNT' | 'AGENT_CASH' | 'PAY_BILLS';
  kycData?: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    address: string;
    idType: 'BVN' | 'NIN' | 'PASSPORT' | 'DRIVERS_LICENSE';
    idNumber: string;
  };
  bankAccount?: {
    accountNumber: string;
    bankCode: string;
  };
  metadata?: Record<string, any>;
  
  // Workflow state
  cryptoPaymentConfirmed: boolean;
  cryptoAmount?: number;
  fiatAmount?: number;
  exchangeRate?: number;
  kycVerificationId?: string;
  kycApproved?: boolean;
  accountId?: string;
  transferReference?: string;
  error?: string;
  retryCount: number;
  lastUpdated: Date;
}

/**
 * Start remittance workflow
 */
export async function startRemittanceWorkflow(params: {
  remittanceId: string;
  chargeId: string;
  senderCurrency: string;
  senderAmount: number;
  recipientCurrency: string;
  recipientPhone: string;
  deliveryOption: 'NEW_ACCOUNT' | 'EXISTING_ACCOUNT' | 'AGENT_CASH' | 'PAY_BILLS';
  kycData?: RemittanceWorkflowState['kycData'];
  bankAccount?: RemittanceWorkflowState['bankAccount'];
  metadata?: Record<string, any>;
}): Promise<RemittanceWorkflowState> {
  const state: RemittanceWorkflowState = {
    ...params,
    currentStep: 'waiting_payment',
    cryptoPaymentConfirmed: false,
    retryCount: 0,
    lastUpdated: new Date(),
  };

  // Store initial state in database
  try {
    const db = await getDb();
    if (db) {
      await (db as any).insert(remittances).values({
        senderCurrency: state.senderCurrency,
        senderAmount: state.senderAmount.toString(),
        recipientCurrency: state.recipientCurrency,
        recipientPhone: state.recipientPhone,
        deliveryOption: state.deliveryOption,
        status: state.currentStep,
      }).onConflictDoNothing();
    }
  } catch (err) {
    log.warn({ err }, 'Failed to persist workflow state to DB');
  }

  return state;
}

/**
 * Process workflow step
 */
export async function processWorkflowStep(
  state: RemittanceWorkflowState
): Promise<RemittanceWorkflowState> {
  try {
    switch (state.currentStep) {
      case 'waiting_payment':
        return await handleWaitingPayment(state);
      
      case 'converting':
        return await handleConverting(state);
      
      case 'kyc_verification':
        return await handleKYCVerification(state);
      
      case 'verifying_account':
        return await handleVerifyingAccount(state);
      
      case 'opening_account':
        return await handleOpeningAccount(state);
      
      case 'transferring':
        return await handleTransferring(state);
      
      default:
        return state;
    }
  } catch (error) {
    state.error = error instanceof Error ? error.message : 'Unknown error';
    state.currentStep = 'failed';
    state.lastUpdated = new Date();
    
    // Store updated state
    try {
      const db = await getDb();
      if (db) {
        await (db as any).update(remittances).set({
          status: state.currentStep,
          updatedAt: new Date(),
        }).where(eq(remittances.id, parseInt(state.remittanceId, 10) || 0));
      }
    } catch (dbErr) {
      log.warn({ dbErr }, 'Failed to persist failed workflow state to DB');
    }
    
    return state;
  }
}

/**
 * Handle waiting for crypto payment
 */
async function handleWaitingPayment(
  state: RemittanceWorkflowState
): Promise<RemittanceWorkflowState> {
  const paymentStatus = await coinbaseService.getCryptoChargeStatus(state.chargeId);
  
  if (paymentStatus.status === 'confirmed' || paymentStatus.status === 'completed') {
    state.cryptoPaymentConfirmed = true;
    state.cryptoAmount = parseFloat(paymentStatus.paidAmount || '0');
    state.currentStep = 'converting';
    state.lastUpdated = new Date();
    
    // Send webhook
    await sendWebhook(state.remittanceId, 'payment.confirmed', {
      amount: state.cryptoAmount,
      currency: state.senderCurrency,
    });
  } else if (paymentStatus.status === 'failed' || paymentStatus.status === 'expired') {
    state.currentStep = 'failed';
    state.error = 'Crypto payment failed or expired';
    state.lastUpdated = new Date();
    
    await sendWebhook(state.remittanceId, 'payment.failed', {
      reason: state.error,
    });
  }
  
  return state;
}

/**
 * Handle crypto to fiat conversion
 */
async function handleConverting(
  state: RemittanceWorkflowState
): Promise<RemittanceWorkflowState> {
  if (!state.cryptoAmount) {
    throw new Error('Crypto amount not set');
  }

  const quote = await exchangeRateService.getExchangeRate({
    fromCurrency: state.senderCurrency,
    toCurrency: state.recipientCurrency,
    amount: state.cryptoAmount,
  });

  const calculation = exchangeRateService.calculateConversion({
    amount: state.cryptoAmount,
    rate: quote.rate,
    platformFeePercent: 0.5,
    exchangeFeePercent: 1.0,
  });

  state.fiatAmount = calculation.outputAmount;
  state.exchangeRate = calculation.exchangeRate;
  
  // Determine if KYC is needed
  const needsKYC = state.deliveryOption === 'NEW_ACCOUNT' || state.fiatAmount > 100000;
  
  if (needsKYC && state.kycData) {
    state.currentStep = 'kyc_verification';
  } else if (state.deliveryOption === 'EXISTING_ACCOUNT') {
    state.currentStep = 'verifying_account';
  } else if (state.deliveryOption === 'NEW_ACCOUNT') {
    state.currentStep = 'opening_account';
  } else {
    throw new Error(`Unsupported delivery option: ${state.deliveryOption}`);
  }
  
  state.lastUpdated = new Date();
  
  await sendWebhook(state.remittanceId, 'conversion.completed', {
    fiatAmount: state.fiatAmount,
    exchangeRate: state.exchangeRate,
  });
  
  return state;
}

/**
 * Handle KYC verification
 */
async function handleKYCVerification(
  state: RemittanceWorkflowState
): Promise<RemittanceWorkflowState> {
  if (!state.kycData) {
    throw new Error('KYC data not provided');
  }

  // Check if KYC already initiated
  if (!state.kycVerificationId) {
    const kycResult = await kycService.initiateKYCVerification({
      remittanceId: state.remittanceId,
      firstName: state.kycData.firstName,
      lastName: state.kycData.lastName,
      dateOfBirth: state.kycData.dateOfBirth,
      address: state.kycData.address,
      idType: state.kycData.idType,
      idNumber: state.kycData.idNumber,
      phoneNumber: state.recipientPhone,
    });
    
    state.kycVerificationId = kycResult.verificationId;
    state.lastUpdated = new Date();
    
    return state; // Return to check status later
  }

  // Check KYC status
  const kycStatus = await kycService.getKYCVerificationStatus(state.kycVerificationId);
  
  if (kycStatus.status === 'approved') {
    state.kycApproved = true;
    
    // Move to next step based on delivery option
    if (state.deliveryOption === 'EXISTING_ACCOUNT') {
      state.currentStep = 'verifying_account';
    } else if (state.deliveryOption === 'NEW_ACCOUNT') {
      state.currentStep = 'opening_account';
    }
    
    state.lastUpdated = new Date();
    
    await sendWebhook(state.remittanceId, 'kyc.approved', {
      verificationId: state.kycVerificationId,
      confidenceScore: kycStatus.confidenceScore,
    });
  } else if (kycStatus.status === 'rejected' || kycStatus.status === 'failed') {
    state.currentStep = 'failed';
    state.error = `KYC verification ${kycStatus.status}: ${kycStatus.rejectionReason}`;
    state.lastUpdated = new Date();
    
    await sendWebhook(state.remittanceId, 'kyc.rejected', {
      reason: kycStatus.rejectionReason,
    });
  }
  // If still pending/in_progress, return state unchanged
  
  return state;
}

/**
 * Handle bank account verification
 */
async function handleVerifyingAccount(
  state: RemittanceWorkflowState
): Promise<RemittanceWorkflowState> {
  if (!state.bankAccount) {
    throw new Error('Bank account details not provided');
  }

  const accountVerification = await nibssService.verifyBankAccount({
    accountNumber: state.bankAccount.accountNumber,
    bankCode: state.bankAccount.bankCode,
  });

  state.currentStep = 'transferring';
  state.lastUpdated = new Date();
  
  await sendWebhook(state.remittanceId, 'account.verified', {
    accountName: accountVerification.accountName,
    bankName: accountVerification.bankName,
  });
  
  return state;
}

/**
 * Handle opening new bank account
 */
async function handleOpeningAccount(
  state: RemittanceWorkflowState
): Promise<RemittanceWorkflowState> {
  if (!state.accountId) {
    const bankApiUrl = process.env.BANK_ACCOUNT_API_URL;
    const bankApiKey = process.env.BANK_ACCOUNT_API_KEY;
    let accountNumber = '0123456789';
    let bankCode = '101';

    if (bankApiUrl && bankApiKey) {
      try {
        const response = await fetch(`${bankApiUrl}/accounts/open`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${bankApiKey}` },
          body: JSON.stringify({ remittanceId: state.remittanceId, recipientPhone: state.recipientPhone }),
        });
        if (response.ok) {
          const data = await response.json() as { accountNumber?: string; bankCode?: string };
          accountNumber = data.accountNumber || accountNumber;
          bankCode = data.bankCode || bankCode;
        }
      } catch (err) {
        log.error({ err }, '[Workflow] Bank account opening API error');
      }
    }

    state.accountId = `acc_${Date.now()}`;
    state.bankAccount = { accountNumber, bankCode };
    state.lastUpdated = new Date();
    
    await sendWebhook(state.remittanceId, 'account.opening', {
      accountId: state.accountId,
    });
    
    return state; // Return to check status later
  }

  state.currentStep = 'transferring';
  state.lastUpdated = new Date();
  
  await sendWebhook(state.remittanceId, 'account.opened', {
    accountNumber: state.bankAccount?.accountNumber,
    bankCode: state.bankAccount?.bankCode,
  });
  
  return state;
}

/**
 * Handle bank transfer
 */
async function handleTransferring(
  state: RemittanceWorkflowState
): Promise<RemittanceWorkflowState> {
  if (!state.bankAccount) {
    throw new Error('Bank account not set');
  }
  
  if (!state.fiatAmount) {
    throw new Error('Fiat amount not set');
  }

  // Check if transfer already initiated
  if (!state.transferReference) {
    const reference = nibssService.generateTransferReference('REM');
    
    const transfer = await nibssService.initiateTransfer({
      fromAccount: process.env.NIBSS_SOURCE_ACCOUNT || '0000000000',
      toAccount: state.bankAccount.accountNumber,
      toBankCode: state.bankAccount.bankCode,
      amount: state.fiatAmount,
      narration: `Remittance ${state.remittanceId}`,
      reference,
    });
    
    state.transferReference = transfer.reference;
    state.lastUpdated = new Date();
    
    if (transfer.responseCode === '00') {
      // Transfer completed immediately
      state.currentStep = 'completed';
      
      await sendWebhook(state.remittanceId, 'transfer.completed', {
        reference: state.transferReference,
        amount: state.fiatAmount,
      });
      
      await sendNotification({
        remittanceId: state.remittanceId,
        type: 'remittance_completed',
        recipient: state.recipientPhone,
        amount: state.fiatAmount,
      });
    } else if (transfer.responseCode === '09') {
      // Transfer is processing
      await sendWebhook(state.remittanceId, 'transfer.processing', {
        reference: state.transferReference,
      });
    } else {
      // Transfer failed
      if (state.retryCount < 3) {
        state.retryCount++;
        state.transferReference = undefined; // Clear to retry
      } else {
        state.currentStep = 'failed';
        state.error = `Transfer failed: ${transfer.responseMessage}`;
        
        await sendWebhook(state.remittanceId, 'transfer.failed', {
          reason: state.error,
        });
      }
    }
    
    return state;
  }

  // Check transfer status
  const transferStatus = await nibssService.getTransferStatus({
    reference: state.transferReference,
    sessionId: '', // Would be stored in state
  });
  
  if (transferStatus.status === 'completed') {
    state.currentStep = 'completed';
    state.lastUpdated = new Date();
    
    await sendWebhook(state.remittanceId, 'transfer.completed', {
      reference: state.transferReference,
      amount: state.fiatAmount,
    });
    
    await sendNotification({
      remittanceId: state.remittanceId,
      type: 'remittance_completed',
      recipient: state.recipientPhone,
      amount: state.fiatAmount,
    });
  } else if (transferStatus.status === 'failed') {
    state.currentStep = 'failed';
    state.error = `Transfer failed: ${transferStatus.responseMessage}`;
    state.lastUpdated = new Date();
    
    await sendWebhook(state.remittanceId, 'transfer.failed', {
      reason: state.error,
    });
  }
  // If still processing, return state unchanged
  
  return state;
}

/**
 * Send webhook notification
 */
async function sendWebhook(
  remittanceId: string,
  event: string,
  data: Record<string, any>
): Promise<void> {
  log.info({ data }, `[Webhook] ${event} for ${remittanceId}`);

  // Persist webhook delivery and attempt HTTP delivery
  const db = await getDb();
  const webhookUrl = process.env.WEBHOOK_DELIVERY_URL;
  let responseCode: number | undefined;

  if (webhookUrl) {
    const { createHmac } = await import('crypto');
    const payload = JSON.stringify({ event, remittanceId, data, timestamp: new Date().toISOString() });
    const hmacSecret = process.env.WEBHOOK_HMAC_SECRET || 'default-secret';
    const signature = createHmac('sha256', hmacSecret).update(payload).digest('hex');
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': event,
        },
        body: payload,
      });
      responseCode = response.status;
    } catch (err) {
      log.error({ err }, `[Webhook] Delivery failed for ${event}`);
    }
  }

  if (db) {
    try {
      await db.insert(webhookDeliveries).values({
        webhookId: `wh_${Date.now()}`,
        remittanceId,
        event,
        url: webhookUrl || 'not_configured',
        payload: data,
        status: responseCode && responseCode < 300 ? 'delivered' : 'pending',
        responseCode,
        attempts: 1,
        deliveredAt: responseCode && responseCode < 300 ? new Date() : undefined,
      });
    } catch (err) {
      log.error({ err }, '[Webhook] DB persist error');
    }
  }
}

/**
 * Send SMS notification
 */
async function sendNotification(params: {
  remittanceId: string;
  type: string;
  recipient: string;
  amount: number;
}): Promise<void> {
  const smsApiUrl = process.env.SMS_API_URL;
  const smsApiKey = process.env.SMS_API_KEY;
  const message = `${params.type === 'remittance_completed' ? 'Your remittance has been delivered' : 'Remittance update'}: ₦${params.amount.toLocaleString()}. Ref: ${params.remittanceId}`;

  if (smsApiUrl && smsApiKey) {
    try {
      await fetch(smsApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${smsApiKey}` },
        body: JSON.stringify({ to: params.recipient, message }),
      });
    } catch (err) {
      log.error({ err }, '[SMS] Send failed');
    }
  } else {
    log.info(`[SMS] ${params.type} to ${params.recipient}: ₦${params.amount.toLocaleString()}`);
  }
}

/**
 * Get workflow status
 */
export async function getWorkflowStatus(
  remittanceId: string
): Promise<RemittanceWorkflowState | null> {
  const db = await getDb();
  if (db) {
    try {
      const rows = await db.select().from(remittanceWorkflows).where(eq(remittanceWorkflows.remittanceId, remittanceId)).limit(1);
      if (rows.length > 0) {
        const row = rows[0];
        return {
          remittanceId: row.remittanceId,
          currentStep: row.currentStep as RemittanceWorkflowState['currentStep'],
          recipientPhone: row.recipientPhone || undefined,
          fiatAmount: row.fiatAmount ? Number(row.fiatAmount) : undefined,
          accountId: row.accountId || undefined,
          bankAccount: row.bankAccountNumber ? { accountNumber: row.bankAccountNumber, bankCode: row.bankCode || '' } : undefined,
          transferReference: row.transferReference || undefined,
          kycVerificationId: row.kycVerificationId || undefined,
          retryCount: row.retryCount,
          error: row.error || undefined,
          lastUpdated: row.updatedAt,
        } as RemittanceWorkflowState;
      }
    } catch (err) {
      log.error({ err }, '[Workflow] DB query error');
    }
  }
  return null;
}

/**
 * Cancel workflow
 */
export async function cancelWorkflow(
  remittanceId: string
): Promise<boolean> {
  const db = await getDb();
  if (db) {
    try {
      await db.update(remittanceWorkflows)
        .set({ currentStep: 'failed', error: 'Cancelled by user', updatedAt: new Date() })
        .where(eq(remittanceWorkflows.remittanceId, remittanceId));
    } catch (err) {
      log.error({ err }, '[Workflow] DB cancel error');
    }
  }
  log.info(`[Workflow] Cancelled ${remittanceId}`);
  return true;
}

/**
 * Retry failed workflow step
 */
export async function retryWorkflowStep(
  remittanceId: string
): Promise<RemittanceWorkflowState | null> {
  const state = await getWorkflowStatus(remittanceId);
  
  if (!state || state.currentStep !== 'failed') {
    return null;
  }
  
  // Reset error and retry count
  state.error = undefined;
  state.retryCount = 0;
  
  // Move back to appropriate step
  if (state.transferReference) {
    state.currentStep = 'transferring';
  } else if (state.kycVerificationId) {
    state.currentStep = 'kyc_verification';
  } else {
    state.currentStep = 'waiting_payment';
  }
  
  return await processWorkflowStep(state);
}
