import { createChildLogger } from '../lib/logger';

const log = createChildLogger('sms');
/**
 * SMS Service
 * 
 * Handles SMS sending for recovery codes, verification, etc.
 * Uses Twilio API for SMS delivery in production.
 * Local development mode simulates SMS by logging to console and saving to files.
 */

interface SendSMSParams {
  to: string;
  message: string;
}

interface SendRecoverySMSParams {
  to: string;
  recoveryCode: string;
  expiresInHours: number;
}

/**
 * Send SMS (supports both Twilio and local development mode)
 */
export async function sendSMS(params: SendSMSParams): Promise<{ success: boolean; error?: string }> {
  const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
  const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
  const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
  
  // If Twilio credentials are configured, use real SMS service
  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER) {
    try {
      // Twilio API endpoint
      const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
      
      // Create form data
      const formData = new URLSearchParams();
      formData.append('To', params.to);
      formData.append('From', TWILIO_PHONE_NUMBER);
      formData.append('Body', params.message);
      
      // Send request with Basic Auth
      const authHeader = 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      if (!response.ok) {
        const error = await response.text();
        log.error({ err: error }, '[SMS] Failed to send SMS:');
        return { success: false, error: 'Failed to send SMS' };
      }

      const data = await response.json();
      log.info('[SMS] SMS sent successfully:', data.sid);
      return { success: true };
    } catch (error) {
      log.error({ err: error }, '[SMS] Error sending SMS:');
      return { success: false, error: 'SMS service error' };
    }
  }

  // Local development mode - log to console and save to file
  log.info('\n' + '='.repeat(80));
  log.info('📱 SMS SENT (Local Development Mode)');
  log.info('='.repeat(80));
  log.info(`To: ${params.to}`);
  log.info('-'.repeat(80));
  log.info(params.message);
  log.info('='.repeat(80) + '\n');

  // Save SMS to file for testing
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const smsDir = path.join(process.cwd(), 'storage', 'sms');
    await fs.mkdir(smsDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `sms-${timestamp}.txt`;
    const filepath = path.join(smsDir, filename);
    
    const smsContent = `
SMS Message (Local Development)
================================

To: ${params.to}
Sent: ${new Date().toISOString()}

Message:
${params.message}

================================
    `.trim();
    
    await fs.writeFile(filepath, smsContent, 'utf-8');
    log.info(`[SMS] Saved to: ${filepath}`);
  } catch (error) {
    log.error({ err: error }, '[SMS] Failed to save SMS to file:');
  }

  return { success: true };
}

/**
 * Send recovery code via SMS
 */
export async function sendRecoverySMS(params: SendRecoverySMSParams): Promise<{ success: boolean; error?: string }> {
  const message = generateRecoverySMSMessage({
    recoveryCode: params.recoveryCode,
    expiresInHours: params.expiresInHours,
  });

  return sendSMS({
    to: params.to,
    message,
  });
}

/**
 * Generate SMS message for recovery code
 */
function generateRecoverySMSMessage(params: { recoveryCode: string; expiresInHours: number }): string {
  return `
Your account recovery code is: ${params.recoveryCode}

This code expires in ${params.expiresInHours} hours.

If you didn't request this code, please ignore this message and ensure your account is secure.

Never share this code with anyone.
  `.trim();
}

/**
 * Validate phone number format
 */
export function isValidPhoneNumber(phone: string): boolean {
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // Check if it's a valid length (10-15 digits)
  if (cleaned.length < 10 || cleaned.length > 15) {
    return false;
  }
  
  // Basic validation passed
  return true;
}

/**
 * Format phone number to E.164 format
 * Assumes US numbers if no country code provided
 */
export function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // If it starts with 1 and is 11 digits, it's already formatted
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }
  
  // If it's 10 digits, assume US and add +1
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }
  
  // If it already has a country code, add +
  if (cleaned.length > 10) {
    return `+${cleaned}`;
  }
  
  // Return as-is if we can't determine format
  return phone;
}
