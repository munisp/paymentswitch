/**
 * Login Notification Service
 * 
 * Sends security alerts when users log in from new devices or locations
 */

import { sendEmail } from './emailService';
import { sendSMS } from './smsService';
import { getDb } from '../db';
import { users } from '../../drizzle/schema';
import { eq } from 'drizzle-orm';
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('loginNotification');

interface LoginNotificationParams {
  userId: number;
  deviceInfo: {
    userAgent: string;
    ipAddress: string;
    deviceName?: string;
    browser?: string;
    os?: string;
    location?: string;
  };
  isNewDevice: boolean;
  isSuspicious: boolean;
}

interface NotificationPreferences {
  emailNotifications: boolean;
  smsNotifications: boolean;
  newDeviceAlerts: boolean;
  suspiciousActivityAlerts: boolean;
}

/**
 * Send login notification to user
 */
export async function sendLoginNotification(params: LoginNotificationParams): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) {
    return { success: false, error: 'Database not available' };
  }

  try {
    // Check user notification preferences
    const { getNotificationPreferences } = await import('./notificationPreferencesService');
    const prefs = await getNotificationPreferences(params.userId);
    
    // Check if user wants login notifications
    if (prefs) {
      const wantsNewDeviceAlerts = params.isNewDevice && !!prefs.newDeviceAlerts;
      const wantsSuspiciousAlerts = params.isSuspicious && !!prefs.suspiciousActivityAlerts;
      const wantsLoginAlerts = !!prefs.loginAlerts;
      
      // Skip if user doesn't want this type of notification
      if (!wantsNewDeviceAlerts && !wantsSuspiciousAlerts && !wantsLoginAlerts) {
        return { success: true }; // Silently skip
      }
      
      // Skip if email notifications are disabled
      if (!prefs.emailNotifications) {
        return { success: true }; // Silently skip
      }
    }
    
    // Get user info
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    // Get notification preferences (for now, default to email only)
    const preferences: NotificationPreferences = {
      emailNotifications: true,
      smsNotifications: false,
      newDeviceAlerts: true,
      suspiciousActivityAlerts: true,
    };

    // Determine if we should send notification
    const shouldNotify = 
      (params.isNewDevice && preferences.newDeviceAlerts) ||
      (params.isSuspicious && preferences.suspiciousActivityAlerts);

    if (!shouldNotify) {
      return { success: true }; // Notification not needed
    }

    // Send email notification
    if (preferences.emailNotifications && user.email) {
      const emailResult = await sendLoginNotificationEmail({
        to: user.email,
        userName: user.name || 'User',
        deviceInfo: params.deviceInfo,
        isNewDevice: params.isNewDevice,
        isSuspicious: params.isSuspicious,
        timestamp: new Date(),
      });

      if (!emailResult.success) {
        log.error({ err: emailResult.error }, '[LoginNotification] Failed to send email:');
      }
    }

    // Send SMS notification if enabled (future enhancement)
    // if (preferences.smsNotifications && user.phoneNumber) {
    //   await sendLoginNotificationSMS({ ... });
    // }

    return { success: true };
  } catch (error) {
    log.error({ err: error }, '[LoginNotification] Error sending notification:');
    return { success: false, error: 'Failed to send notification' };
  }
}

/**
 * Send login notification email
 */
async function sendLoginNotificationEmail(params: {
  to: string;
  userName: string;
  deviceInfo: {
    userAgent: string;
    ipAddress: string;
    deviceName?: string;
    browser?: string;
    os?: string;
    location?: string;
  };
  isNewDevice: boolean;
  isSuspicious: boolean;
  timestamp: Date;
}): Promise<{ success: boolean; error?: string }> {
  const subject = params.isSuspicious 
    ? '🔒 Suspicious Login Detected'
    : '🔔 New Device Login Alert';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <div style="background-color: #f5f5f5; padding: 40px 20px;">
    <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
      <!-- Header -->
      <div style="background: ${params.isSuspicious ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'}; padding: 32px 24px; text-align: center;">
        <div style="font-size: 48px; margin-bottom: 16px;">${params.isSuspicious ? '🔒' : '🔔'}</div>
        <h1 style="color: white; margin: 0; font-size: 24px; font-weight: 600;">
          ${params.isSuspicious ? 'Suspicious Login Detected' : 'New Device Login'}
        </h1>
      </div>

      <!-- Content -->
      <div style="padding: 32px 24px;">
        <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
          Hi ${params.userName},
        </p>

        <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
          ${params.isSuspicious 
            ? 'We detected a login to your account that looks suspicious. If this wasn\'t you, please secure your account immediately.' 
            : 'We detected a login to your account from a new device. If this was you, you can ignore this message.'}
        </p>

        <!-- Login Details -->
        <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
          <h2 style="color: #111827; font-size: 18px; font-weight: 600; margin: 0 0 16px 0;">
            Login Details
          </h2>
          
          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Time:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">
                ${params.timestamp.toLocaleString('en-US', { 
                  dateStyle: 'medium', 
                  timeStyle: 'short' 
                })}
              </td>
            </tr>
            ${params.deviceInfo.browser ? `
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Browser:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">
                ${params.deviceInfo.browser}
              </td>
            </tr>
            ` : ''}
            ${params.deviceInfo.os ? `
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Operating System:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">
                ${params.deviceInfo.os}
              </td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">IP Address:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">
                ${params.deviceInfo.ipAddress}
              </td>
            </tr>
            ${params.deviceInfo.location ? `
            <tr>
              <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Location:</td>
              <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 500; text-align: right;">
                ${params.deviceInfo.location}
              </td>
            </tr>
            ` : ''}
          </table>
        </div>

        ${params.isSuspicious ? `
        <!-- Security Warning -->
        <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
          <p style="color: #991b1b; font-size: 14px; line-height: 1.6; margin: 0; font-weight: 500;">
            ⚠️ If you don't recognize this activity, please:
          </p>
          <ul style="color: #991b1b; font-size: 14px; line-height: 1.6; margin: 12px 0 0 0; padding-left: 20px;">
            <li>Change your password immediately</li>
            <li>Review your account activity</li>
            <li>Enable two-factor authentication if not already enabled</li>
            <li>Contact support if you need assistance</li>
          </ul>
        </div>
        ` : `
        <!-- Info Box -->
        <div style="background-color: #eff6ff; border-left: 4px solid #3b82f6; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
          <p style="color: #1e40af; font-size: 14px; line-height: 1.6; margin: 0;">
            ℹ️ This is a security notification to keep you informed about account activity. If this was you, no action is needed.
          </p>
        </div>
        `}

        <!-- Action Buttons -->
        <div style="text-align: center; margin-top: 32px;">
          ${params.isSuspicious ? `
          <a href="${process.env.VITE_FRONTEND_FORGE_API_URL || 'https://app.example.com'}/settings/security" 
             style="display: inline-block; background-color: #ef4444; color: white; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600; font-size: 16px;">
            Secure My Account
          </a>
          ` : `
          <a href="${process.env.VITE_FRONTEND_FORGE_API_URL || 'https://app.example.com'}/settings/trusted-devices" 
             style="display: inline-block; background-color: #3b82f6; color: white; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600; font-size: 16px;">
            Manage Devices
          </a>
          `}
        </div>
      </div>

      <!-- Footer -->
      <div style="background-color: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
        <p style="color: #6b7280; font-size: 12px; line-height: 1.6; margin: 0 0 8px 0;">
          This is an automated security notification. Please do not reply to this email.
        </p>
        <p style="color: #6b7280; font-size: 12px; line-height: 1.6; margin: 0;">
          © 2024 Crypto Remittance Platform. All rights reserved.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text = `
${subject}

Hi ${params.userName},

${params.isSuspicious 
  ? 'We detected a login to your account that looks suspicious. If this wasn\'t you, please secure your account immediately.' 
  : 'We detected a login to your account from a new device. If this was you, you can ignore this message.'}

Login Details:
- Time: ${params.timestamp.toLocaleString()}
${params.deviceInfo.browser ? `- Browser: ${params.deviceInfo.browser}` : ''}
${params.deviceInfo.os ? `- Operating System: ${params.deviceInfo.os}` : ''}
- IP Address: ${params.deviceInfo.ipAddress}
${params.deviceInfo.location ? `- Location: ${params.deviceInfo.location}` : ''}

${params.isSuspicious 
  ? `If you don't recognize this activity, please:
- Change your password immediately
- Review your account activity
- Enable two-factor authentication if not already enabled
- Contact support if you need assistance`
  : 'This is a security notification to keep you informed about account activity. If this was you, no action is needed.'}

---
This is an automated security notification.
© 2024 Crypto Remittance Platform
  `.trim();

  return sendEmail({
    to: params.to,
    subject,
    html,
    text,
  });
}

/**
 * Parse user agent string to extract device info
 */
export function parseUserAgent(userAgent: string): {
  browser?: string;
  os?: string;
  deviceName?: string;
} {
  const result: { browser?: string; os?: string; deviceName?: string } = {};

  // Detect browser
  if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
    result.browser = 'Chrome';
  } else if (userAgent.includes('Firefox')) {
    result.browser = 'Firefox';
  } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
    result.browser = 'Safari';
  } else if (userAgent.includes('Edg')) {
    result.browser = 'Edge';
  } else if (userAgent.includes('Opera') || userAgent.includes('OPR')) {
    result.browser = 'Opera';
  }

  // Detect OS
  if (userAgent.includes('Windows')) {
    result.os = 'Windows';
  } else if (userAgent.includes('Mac OS X')) {
    result.os = 'macOS';
  } else if (userAgent.includes('Linux')) {
    result.os = 'Linux';
  } else if (userAgent.includes('Android')) {
    result.os = 'Android';
  } else if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) {
    result.os = 'iOS';
  }

  // Generate device name
  if (result.browser && result.os) {
    result.deviceName = `${result.browser} on ${result.os}`;
  } else {
    result.deviceName = 'Unknown Device';
  }

  return result;
}

/**
 * Determine if login is suspicious based on various factors
 */
export function isSuspiciousLogin(params: {
  userAgent: string;
  ipAddress: string;
  lastLoginIp?: string;
  lastLoginUserAgent?: string;
  failedAttempts?: number;
}): boolean {
  // Check for significantly different user agent
  if (params.lastLoginUserAgent && params.userAgent !== params.lastLoginUserAgent) {
    const lastDevice = parseUserAgent(params.lastLoginUserAgent);
    const currentDevice = parseUserAgent(params.userAgent);
    
    // Different OS is more suspicious than different browser
    if (lastDevice.os && currentDevice.os && lastDevice.os !== currentDevice.os) {
      return true;
    }
  }

  // Check for different IP address (basic check - in production, use geolocation)
  if (params.lastLoginIp && params.ipAddress !== params.lastLoginIp) {
    // In production, you'd check if IPs are from different countries/regions
    // For now, just flag if completely different
    const lastIpPrefix = params.lastLoginIp.split('.').slice(0, 2).join('.');
    const currentIpPrefix = params.ipAddress.split('.').slice(0, 2).join('.');
    
    if (lastIpPrefix !== currentIpPrefix) {
      return true;
    }
  }

  // Check for recent failed login attempts
  if (params.failedAttempts && params.failedAttempts >= 3) {
    return true;
  }

  return false;
}
