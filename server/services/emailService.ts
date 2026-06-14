import { createChildLogger } from '../lib/logger';

const log = createChildLogger('email');
/**
 * Email Service
 * 
 * Handles email sending for recovery codes, notifications, etc.
 * Uses Resend API for email delivery.
 */

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface SendRecoveryCodeParams {
  to: string;
  recoveryCode: string;
  expiresInHours: number;
}

/**
 * Send email (local development mode - logs to console and saves to file)
 * In production, this would integrate with a real email service like Resend, SendGrid, or AWS SES
 */
export async function sendEmail(params: SendEmailParams): Promise<{ success: boolean; error?: string }> {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  
  // If API key is configured, use real email service
  if (RESEND_API_KEY) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM || 'noreply@example.com',
          to: params.to,
          subject: params.subject,
          html: params.html,
          text: params.text,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        log.error({ err: error }, '[Email] Failed to send email:');
        return { success: false, error: 'Failed to send email' };
      }

      const data = await response.json();
      log.info('[Email] Email sent successfully:', data.id);
      return { success: true };
    } catch (error) {
      log.error({ err: error }, '[Email] Error sending email:');
      return { success: false, error: 'Email service error' };
    }
  }

  // Local development mode - log to console and save to file
  log.info('\n' + '='.repeat(80));
  log.info('📧 EMAIL SENT (Local Development Mode)');
  log.info('='.repeat(80));
  log.info(`To: ${params.to}`);
  log.info(`Subject: ${params.subject}`);
  log.info('-'.repeat(80));
  log.info(params.text || 'No plain text version');
  log.info('='.repeat(80) + '\n');

  // Save email to file for testing
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    
    const emailsDir = path.join(process.cwd(), 'storage', 'emails');
    await fs.mkdir(emailsDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `email-${timestamp}.html`;
    const filepath = path.join(emailsDir, filename);
    
    const emailContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${params.subject}</title>
</head>
<body>
  <div style="font-family: monospace; padding: 20px; background: #f5f5f5;">
    <div style="background: white; padding: 20px; border-radius: 8px; max-width: 600px; margin: 0 auto;">
      <h2>Email Preview (Local Development)</h2>
      <p><strong>To:</strong> ${params.to}</p>
      <p><strong>Subject:</strong> ${params.subject}</p>
      <hr>
      ${params.html}
    </div>
  </div>
</body>
</html>
    `;
    
    await fs.writeFile(filepath, emailContent, 'utf-8');
    log.info(`[Email] Saved to: ${filepath}`);
  } catch (error) {
    log.error({ err: error }, '[Email] Failed to save email to file:');
  }

  return { success: true };
}

/**
 * Send recovery code email
 */
export async function sendRecoveryCodeEmail(params: SendRecoveryCodeParams): Promise<{ success: boolean; error?: string }> {
  const html = generateRecoveryCodeEmailHTML({
    recoveryCode: params.recoveryCode,
    expiresInHours: params.expiresInHours,
  });

  const text = generateRecoveryCodeEmailText({
    recoveryCode: params.recoveryCode,
    expiresInHours: params.expiresInHours,
  });

  return sendEmail({
    to: params.to,
    subject: 'Your Account Recovery Code',
    html,
    text,
  });
}

/**
 * Generate HTML email template for recovery code
 */
function generateRecoveryCodeEmailHTML(params: { recoveryCode: string; expiresInHours: number }): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Account Recovery Code</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    .container {
      background-color: #f9fafb;
      border-radius: 8px;
      padding: 32px;
      margin: 20px 0;
    }
    .header {
      text-align: center;
      margin-bottom: 32px;
    }
    .header h1 {
      color: #1f2937;
      font-size: 24px;
      margin: 0 0 8px 0;
    }
    .code-box {
      background-color: #fff;
      border: 2px solid #e5e7eb;
      border-radius: 8px;
      padding: 24px;
      text-align: center;
      margin: 24px 0;
    }
    .code {
      font-size: 32px;
      font-weight: bold;
      letter-spacing: 4px;
      color: #2563eb;
      font-family: 'Courier New', monospace;
    }
    .warning {
      background-color: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 16px;
      margin: 24px 0;
      border-radius: 4px;
    }
    .warning-title {
      font-weight: bold;
      color: #92400e;
      margin: 0 0 8px 0;
    }
    .footer {
      text-align: center;
      color: #6b7280;
      font-size: 14px;
      margin-top: 32px;
      padding-top: 24px;
      border-top: 1px solid #e5e7eb;
    }
    .button {
      display: inline-block;
      background-color: #2563eb;
      color: #fff;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 6px;
      margin: 16px 0;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🔐 Account Recovery</h1>
      <p>You requested to recover access to your account</p>
    </div>

    <p>Hello,</p>
    
    <p>We received a request to recover your account. Use the code below to complete the recovery process:</p>

    <div class="code-box">
      <div style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">Your Recovery Code</div>
      <div class="code">${params.recoveryCode}</div>
    </div>

    <p style="text-align: center;">
      <strong>This code expires in ${params.expiresInHours} hours.</strong>
    </p>

    <div class="warning">
      <div class="warning-title">⚠️ Security Notice</div>
      <p style="margin: 0; color: #92400e;">
        If you didn't request this recovery code, please ignore this email and ensure your account is secure.
        Never share this code with anyone.
      </p>
    </div>

    <p>To complete the recovery process:</p>
    <ol>
      <li>Return to the recovery page</li>
      <li>Enter the code above</li>
      <li>Follow the instructions to reset your 2FA</li>
    </ol>

    <div class="footer">
      <p>This is an automated message, please do not reply to this email.</p>
      <p>If you need assistance, please contact our support team.</p>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Generate plain text email for recovery code
 */
function generateRecoveryCodeEmailText(params: { recoveryCode: string; expiresInHours: number }): string {
  return `
Account Recovery Code

You requested to recover access to your account.

Your Recovery Code: ${params.recoveryCode}

This code expires in ${params.expiresInHours} hours.

To complete the recovery process:
1. Return to the recovery page
2. Enter the code above
3. Follow the instructions to reset your 2FA

SECURITY NOTICE:
If you didn't request this recovery code, please ignore this email and ensure your account is secure.
Never share this code with anyone.

---
This is an automated message, please do not reply to this email.
If you need assistance, please contact our support team.
  `.trim();
}
