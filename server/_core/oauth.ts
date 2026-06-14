import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('oauth');

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }

    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      // Handle both Keycloak standard claims (sub) and legacy format (openId)
      // Keycloak returns 'sub' as the subject identifier, but our system uses 'openId'
      const openId = userInfo.openId ?? (userInfo as any).sub;
      
      if (!openId) {
        log.error({ keys: Object.keys(userInfo) }, "[OAuth] Missing user identifier - neither openId nor sub found in userInfo");
        res.status(400).json({ error: "User identifier (openId/sub) missing from user info" });
        return;
      }

      await db.upsertUser({
        sub: openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      // Get user to check 2FA status
      const user = await db.getUserByOpenId(openId);

      // Check if user wants to be remembered (from query param or default to 7 days)
      const rememberMe = getQueryParam(req, 'rememberMe') === 'true';
      const sessionDuration = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000; // 30 days or 7 days
      
      const sessionToken = await sdk.createSessionToken(openId, {
        name: userInfo.name || "",
        expiresInMs: sessionDuration,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      // Log login activity and send notification
      if (user) {
        const { logLoginAttempt, generateSessionId } = await import('../services/accountActivityService');
        const sessionId = generateSessionId();
        const userAgent = req.headers['user-agent'] || 'Unknown';
        const ipAddress = req.ip;
        
        // Check if this is a new device
        const crypto = await import('crypto');
        const fingerprintData = { userAgent };
        const deviceFingerprint = crypto.createHash('sha256')
          .update(JSON.stringify(fingerprintData))
          .digest('hex');
        
        // Check if device is trusted (indicates not a new device)
        const { verifyTrustedDevice } = await import('../services/trustedDeviceService');
        const { trusted } = await verifyTrustedDevice({
          userId: user.id,
          deviceFingerprint,
        });
        
        const isNewDevice = !trusted;
        
        // Determine if login is suspicious
        const { isSuspiciousLogin, parseUserAgent } = await import('../services/loginNotificationService');
        const suspicious = isSuspiciousLogin({
          userAgent,
          ipAddress: ipAddress || 'Unknown',
          // In production, you'd fetch lastLoginIp and lastLoginUserAgent from database
        });
        
        // Send notification if new device or suspicious
        if (isNewDevice || suspicious) {
          const { sendLoginNotification } = await import('../services/loginNotificationService');
          const deviceInfo = parseUserAgent(userAgent);
          
          // Send notification asynchronously (don't block login)
          // Log the login attempt
          await logLoginAttempt({
            userId: user.id,
            success: true,
            userAgent,
            ipAddress: ipAddress || 'Unknown',
            deviceFingerprint,
            isTrustedDevice: trusted,
            requiresTwoFactor: false, // Will be updated if 2FA is required
            twoFactorCompleted: false,
            sessionId,
          });
          
          sendLoginNotification({
            userId: user.id,
            deviceInfo: {
              userAgent,
              ipAddress: ipAddress || 'Unknown',
              ...deviceInfo,
            },
            isNewDevice,
            isSuspicious: suspicious,
          }).catch(error => {
            log.error({ err: error }, '[OAuth] Failed to send login notification:');
          });
        }
      }

      // Check if user has 2FA enabled
      if (user && user.twoFactorEnabled === 'true') {
        // Check if current device is trusted
        const userAgent = req.headers['user-agent'] || 'Unknown';
        const ipAddress = req.ip;
        
        // Generate device fingerprint
        const crypto = await import('crypto');
        const fingerprintData = {
          userAgent,
          // Don't include IP as it may change
        };
        const deviceFingerprint = crypto.createHash('sha256')
          .update(JSON.stringify(fingerprintData))
          .digest('hex');
        
        // Check if device is trusted
        const { verifyTrustedDevice } = await import('../services/trustedDeviceService');
        const { trusted } = await verifyTrustedDevice({
          userId: user.id,
          deviceFingerprint,
        });
        
        if (trusted) {
          // Device is trusted, skip 2FA and redirect to home
          res.redirect(302, "/");
        } else {
          // Device not trusted, require 2FA verification
          res.redirect(302, "/verify-2fa");
        }
      } else {
        // Normal flow - redirect to home
        res.redirect(302, "/");
      }
    } catch (error) {
      log.error({ err: error }, "[OAuth] Callback failed");
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}
