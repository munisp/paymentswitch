import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as db from "./db";
import { users, previewSessions, localCredentials } from "../drizzle/schema";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import {
  randomBytes,
  createHmac,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "crypto";
import { promisify } from "util";
import { analyticsRouter } from "./analytics";
import { webhookRouter } from "./webhooks";
import { feedbackRouter } from "./onboarding/feedbackRouter";
import { correctionRouter } from "./onboarding/correctionRouter";
import { technicalOnboardingRouter } from "./onboarding/technicalOnboardingRouter";
import { notificationRouter } from "./routers/notificationRouter";
import { integrationRouter } from "./onboarding/integrationRouter";
import { apiKeysRouter } from "./api/routers/apiKeys";
import { apiKeyEnhancementsRouter } from "./api/routers/apiKeyEnhancements";
import { notificationChannelsRouter } from "./api/routers/notificationChannels";
import { testingCertificationRouter } from "./api/routers/testingCertification";
import { productionGoLiveRouter } from "./onboarding/productionGoLiveRouter";
import { adminDashboardRouter } from "./admin/adminDashboardRouter";
import { reminderEmailRouter } from "./admin/reminderEmailRouter";
import { remittanceRouter } from "./routers/remittanceRouter";
import { rateAlertRouter } from "./routers/rateAlertRouter";
import * as rateAlertService from "./services/rateAlertService";
import { twoFactorRouter } from "./routers/twoFactorRouter";
import { accountRecoveryRouter } from "./routers/accountRecoveryRouter";
import { trustedDeviceRouter } from "./routers/trustedDeviceRouter";
import { notificationPreferencesRouter } from "./routers/notificationPreferencesRouter";
import { accountActivityRouter } from "./routers/accountActivityRouter";
import { aiRouter } from "./routers/aiRouter";
import { integrationsRouter } from "./routers/integrationsRouter";
import { disputeRouter } from "./routers/disputeRouter";
import { recurringRemittanceRouter } from "./routers/recurringRemittanceRouter";
import { batchTransferRouter } from "./routers/batchTransferRouter";
import { complianceReportRouter } from "./routers/complianceReportRouter";
import { supportTicketRouter } from "./routers/supportTicketRouter";
import { transactionLimitRouter } from "./routers/transactionLimitRouter";
import { feeManagementRouter } from "./routers/feeManagementRouter";
import { userPreferencesRouter } from "./routers/userPreferencesRouter";
import { transactionNoteRouter } from "./routers/transactionNoteRouter";
import { referralRouter } from "./routers/referralRouter";
import { maintenanceRouter } from "./routers/maintenanceRouter";
import { auditLogRouter } from "./routers/auditLogRouter";
import { webhookConfigRouter } from "./routers/webhookConfigRouter";
import { savedSearchRouter } from "./routers/savedSearchRouter";
import { securityRouter } from "./routers/securityRouter";
import { resilienceRouter } from "./routers/resilienceRouter";
import { outboundRemittanceRouter } from "./routers/outboundRemittanceRouter";
import { inboundRemittanceRouter } from "./routers/inboundRemittanceRouter";
import { domesticPaymentsRouter } from "./routers/domesticPaymentsRouter";
import { tradePaymentsRouter } from "./routers/tradePaymentsRouter";
import { cardProcessingRouter } from "./routers/cardProcessingRouter";
import { governmentPaymentsRouter } from "./routers/governmentPaymentsRouter";
import { openBankingRouter } from "./routers/openBankingRouter";
import { middlewareRouter } from "./routers/middlewareRouter";
import { sanctionsScreeningRouter } from "./routers/sanctionsScreeningRouter";
import { settlementRouter } from "./routers/settlementRouter";
import { developerPortalRouter } from "./routers/developerPortalRouter";
import { paymentGatewayRouter } from "./routers/paymentGatewayRouter";
import { billPaymentRouter } from "./routers/billPaymentRouter";
import { mobileMoneyRouter } from "./routers/mobileMoneyRouter";
import { reconciliationRouter } from "./routers/reconciliationRouter";
import { fxRiskRouter } from "./routers/fxRiskRouter";
import { agentCashRouter } from "./routers/agentCashRouter";
import { dashboardRouter, transactionsRouter } from "./routers/mobileRouter";
import {
  startRateAlertMonitor,
  getRateAlertMonitorStatus,
} from "./jobs/rateAlertMonitor";
import {
  exportToCSV,
  exportToExcel,
  exportToPDF,
  formatRemittanceForExport,
  getRemittanceExportColumns,
  formatRateAlertsForExport,
  getRateAlertExportColumns,
} from "./services/exportService";
import { createChildLogger } from "./lib/logger";

const log = createChildLogger("routers");
const scrypt = promisify(scryptCallback);

function localAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.ENABLE_LOCAL_AUTH === "true"
  );
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

async function hashLocalPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function verifyLocalPassword(
  password: string,
  encoded: string
): Promise<boolean> {
  const [algorithm, salt, expectedHex] = encoded.split("$");
  if (
    algorithm !== "scrypt" ||
    !salt ||
    !expectedHex ||
    !/^[0-9a-f]+$/i.test(expectedHex)
  )
    return false;
  const expected = Buffer.from(expectedHex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function assertLocalAuthEnabled(): void {
  if (!localAuthEnabled()) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Local credential authentication is disabled; use Keycloak SSO.",
    });
  }
}

// Helper to generate unique IDs
function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(16).toString("hex")}`;
}

// Helper to generate API credentials
function generateApiCredentials() {
  const apiKey = `pk_${randomBytes(24).toString("hex")}`;
  const apiSecret = `sk_${randomBytes(32).toString("hex")}`;
  return { apiKey, apiSecret };
}

// Helper to generate webhook secret
function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString("hex")}`;
}

// Merchant procedure - requires merchant role
const merchantProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== "merchant" && ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Merchant access required",
    });
  }
  return next({ ctx });
});

export const appRouter = router({
  system: systemRouter,
  analytics: analyticsRouter,
  webhooks: webhookRouter,
  ocrFeedback: feedbackRouter,
  ocrCorrection: correctionRouter,
  technicalOnboarding: technicalOnboardingRouter,
  notification: notificationRouter,
  integration: integrationRouter,
  ai: aiRouter,
  apiKeys: apiKeysRouter,
  apiKeyEnhancements: apiKeyEnhancementsRouter,
  notificationChannels: notificationChannelsRouter,
  testingCertification: testingCertificationRouter,
  productionGoLive: productionGoLiveRouter,
  admin: adminDashboardRouter,
  reminderEmails: reminderEmailRouter,
  remittance: remittanceRouter,
  accountRecovery: accountRecoveryRouter,
  trustedDevice: trustedDeviceRouter,
  notificationPreferences: notificationPreferencesRouter,
  accountActivity: accountActivityRouter,
  integrations: integrationsRouter,
  disputes: disputeRouter,
  recurringRemittances: recurringRemittanceRouter,
  batchTransfers: batchTransferRouter,
  complianceReports: complianceReportRouter,
  supportTickets: supportTicketRouter,
  transactionLimits: transactionLimitRouter,
  feeManagement: feeManagementRouter,
  userPreferences: userPreferencesRouter,
  transactionNotes: transactionNoteRouter,
  referrals: referralRouter,
  maintenance: maintenanceRouter,
  auditLog: auditLogRouter,
  webhookConfig: webhookConfigRouter,
  savedSearches: savedSearchRouter,
  security: securityRouter,
  resilience: resilienceRouter,
  outboundRemittance: outboundRemittanceRouter,
  inboundRemittance: inboundRemittanceRouter,
  domesticPayments: domesticPaymentsRouter,
  tradePayments: tradePaymentsRouter,
  cardProcessing: cardProcessingRouter,
  governmentPayments: governmentPaymentsRouter,
  openBanking: openBankingRouter,
  middleware: middlewareRouter,
  sanctionsScreening: sanctionsScreeningRouter,
  settlements: settlementRouter,
  developerPortal: developerPortalRouter,
  paymentGateway: paymentGatewayRouter,
  billPayments: billPaymentRouter,
  mobileMoney: mobileMoneyRouter,
  reconciliation: reconciliationRouter,
  fxRisk: fxRiskRouter,
  agentCash: agentCashRouter,
  transactions: transactionsRouter,
  dashboard: dashboardRouter,

  // Rate Alerts
  rateAlerts: router({
    create: protectedProcedure
      .input(
        z.object({
          fromCurrency: z.enum(["BTC", "ETH", "USDC", "USDT"]),
          toCurrency: z.enum(["NGN"]),
          targetRate: z.number().positive(),
          condition: z.enum(["above", "below", "exact"]),
          notifyEmail: z.boolean().optional(),
          notifySms: z.boolean().optional(),
          notifyPush: z.boolean().optional(),
          expiresAt: z.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return await rateAlertService.createRateAlert({
          userId: ctx.user.id,
          ...input,
        });
      }),

    list: protectedProcedure.query(async ({ ctx }) => {
      return await rateAlertService.getUserRateAlerts(ctx.user.id);
    }),

    update: protectedProcedure
      .input(
        z.object({
          alertId: z.number(),
          targetRate: z.number().positive().optional(),
          condition: z.enum(["above", "below", "exact"]).optional(),
          notifyEmail: z.boolean().optional(),
          notifySms: z.boolean().optional(),
          notifyPush: z.boolean().optional(),
          expiresAt: z.date().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { alertId, ...updates } = input;
        return await rateAlertService.updateRateAlert(
          alertId,
          ctx.user.id,
          updates
        );
      }),

    delete: protectedProcedure
      .input(
        z.object({
          alertId: z.number(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        return await rateAlertService.deleteRateAlert(
          input.alertId,
          ctx.user.id
        );
      }),

    history: protectedProcedure
      .input(
        z.object({
          limit: z.number().optional().default(50),
        })
      )
      .query(async ({ ctx, input }) => {
        return await rateAlertService.getRateAlertHistory(
          ctx.user.id,
          input.limit
        );
      }),

    monitorStatus: publicProcedure.query(() => {
      return getRateAlertMonitorStatus();
    }),
  }),

  twoFactor: twoFactorRouter,

  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),

    localSignup: publicProcedure
      .input(
        z.object({
          name: z.string().trim().min(2).max(255),
          username: z
            .string()
            .trim()
            .min(3)
            .max(64)
            .regex(/^[a-zA-Z0-9._-]+$/),
          email: z.string().trim().email().max(320),
          password: z.string().min(12).max(128),
        })
      )
      .mutation(async ({ ctx, input }) => {
        assertLocalAuthEnabled();
        const database = await db.getDb();
        if (!database)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Database not available",
          });
        const username = normalizeIdentity(input.username);
        const normalizedEmail = normalizeIdentity(input.email);
        const passwordHash = await hashLocalPassword(input.password);
        const sub = `local-${randomUUID()}`;

        try {
          const createdUser = await database.transaction(async tx => {
            const [created] = await tx
              .insert(users)
              .values({
                sub,
                name: input.name.trim(),
                email: normalizedEmail,
                loginMethod: "local",
                role: "user",
              })
              .returning();
            if (!created) throw new Error("User creation returned no row");
            await tx.insert(localCredentials).values({
              userId: created.id,
              username,
              normalizedEmail,
              passwordHash,
            });
            return created;
          });

          const sessionToken = await sdk.createSessionToken(createdUser.sub, {
            name: createdUser.name ?? input.name.trim(),
          });
          ctx.res.cookie(COOKIE_NAME, sessionToken, {
            ...getSessionCookieOptions(ctx.req),
            maxAge: 1000 * 60 * 60 * 24 * 30,
          });
          return { user: createdUser };
        } catch (error: any) {
          if (error?.code === "23505") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Username or email is already registered",
            });
          }
          throw error;
        }
      }),

    localLogin: publicProcedure
      .input(
        z.object({
          usernameOrEmail: z.string().trim().min(3).max(320),
          password: z.string().min(1).max(128),
        })
      )
      .mutation(async ({ ctx, input }) => {
        assertLocalAuthEnabled();
        const database = await db.getDb();
        if (!database)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Database not available",
          });
        const identity = normalizeIdentity(input.usernameOrEmail);
        const result = await database
          .select({ credential: localCredentials, user: users })
          .from(localCredentials)
          .innerJoin(users, eq(users.id, localCredentials.userId))
          .where(
            or(
              eq(localCredentials.username, identity),
              eq(localCredentials.normalizedEmail, identity)
            )
          )
          .limit(1);
        const match = result[0];
        const genericFailure = () =>
          new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid username/email or password",
          });
        if (!match) throw genericFailure();
        if (
          match.credential.lockedUntil &&
          match.credential.lockedUntil.getTime() > Date.now()
        )
          throw genericFailure();
        const valid = await verifyLocalPassword(
          input.password,
          match.credential.passwordHash
        );
        if (!valid) {
          const attempts = match.credential.failedAttempts + 1;
          await database
            .update(localCredentials)
            .set({
              failedAttempts: attempts,
              lockedUntil:
                attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null,
              updatedAt: new Date(),
            })
            .where(eq(localCredentials.id, match.credential.id));
          throw genericFailure();
        }
        await database
          .update(localCredentials)
          .set({ failedAttempts: 0, lockedUntil: null, updatedAt: new Date() })
          .where(eq(localCredentials.id, match.credential.id));
        await database
          .update(users)
          .set({ lastSignedIn: new Date() })
          .where(eq(users.id, match.user.id));
        const sessionToken = await sdk.createSessionToken(match.user.sub, {
          name: match.user.name ?? "",
        });
        ctx.res.cookie(COOKIE_NAME, sessionToken, {
          ...getSessionCookieOptions(ctx.req),
          maxAge: 1000 * 60 * 60 * 24 * 30,
        });
        return { user: { ...match.user, lastSignedIn: new Date() } };
      }),

    // Check if current session has completed 2FA verification
    session2FAStatus: publicProcedure.query(async ({ ctx }) => {
      if (!ctx.user) {
        return {
          authenticated: false,
          requires2FA: false,
          verified: false,
        };
      }

      const requires2FA = ctx.user.twoFactorEnabled === "true";
      let verified = ctx.session?.twoFactorVerified ?? false;

      // If not verified in session but 2FA is required, check if device is trusted
      if (requires2FA && !verified) {
        const userAgent = ctx.req.headers["user-agent"] || "Unknown";
        const crypto = await import("crypto");
        const fingerprintData = { userAgent };
        const deviceFingerprint = crypto
          .createHash("sha256")
          .update(JSON.stringify(fingerprintData))
          .digest("hex");

        const { verifyTrustedDevice } = await import(
          "./services/trustedDeviceService"
        );
        const { trusted } = await verifyTrustedDevice({
          userId: ctx.user.id,
          deviceFingerprint,
        });

        // If device is trusted, consider it verified
        if (trusted) {
          verified = true;
        }
      }

      return {
        authenticated: true,
        requires2FA,
        verified,
        needsVerification: requires2FA && !verified,
      };
    }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Merchant management
  merchant: router({
    // Create merchant account
    create: protectedProcedure
      .input(
        z.object({
          businessName: z.string().min(1).max(255),
          businessType: z.enum([
            "ecommerce",
            "saas",
            "marketplace",
            "nonprofit",
            "other",
          ]),
          website: z.string().url().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const { apiKey, apiSecret } = generateApiCredentials();
        const webhookSecret = generateWebhookSecret();

        const merchant = await db.createMerchant({
          userId: ctx.user.id,
          businessName: input.businessName,
          businessType: input.businessType,
          website: input.website || null,
          apiKey,
          apiSecret,
          webhookUrl: null,
          webhookSecret,
          status: "pending",
        });

        // Update user role to merchant
        const database = await db.getDb();
        if (database) {
          await database
            .update(users)
            .set({ role: "merchant" })
            .where(eq(users.id, ctx.user.id));
        }

        return {
          ...merchant,
          // Only show API secret once during creation
          apiSecret,
        };
      }),

    // List user's merchants
    list: protectedProcedure.query(async ({ ctx }) => {
      return db.getMerchantsByUserId(ctx.user.id);
    }),

    // Get merchant details
    get: merchantProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const merchant = await db.getMerchantById(input.id);
        if (!merchant) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Merchant not found",
          });
        }
        // Don't expose API secret
        return { ...merchant, apiSecret: undefined };
      }),

    // Update merchant settings
    update: merchantProcedure
      .input(
        z.object({
          id: z.number(),
          businessName: z.string().min(1).max(255).optional(),
          website: z.string().url().optional(),
          webhookUrl: z.string().url().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...updates } = input;
        await db.updateMerchant(id, updates);
        return { success: true };
      }),

    // Regenerate API credentials
    regenerateApiKey: merchantProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const { apiKey, apiSecret } = generateApiCredentials();
        await db.updateMerchant(input.id, { apiKey, apiSecret });
        return { apiKey, apiSecret };
      }),

    // Get branding settings
    getBranding: merchantProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const merchant = await db.getMerchantById(input.id);
        if (!merchant) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Merchant not found",
          });
        }
        return {
          logo: merchant.brandingLogo,
          primaryColor: merchant.brandingPrimaryColor,
          secondaryColor: merchant.brandingSecondaryColor,
          backgroundColor: merchant.brandingBackgroundColor,
          textColor: merchant.brandingTextColor,
          fontFamily: merchant.brandingFontFamily,
          borderRadius: merchant.brandingBorderRadius,
        };
      }),

    // Update branding settings
    updateBranding: merchantProcedure
      .input(
        z.object({
          id: z.number(),
          logo: z.string().url().optional(),
          primaryColor: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/)
            .optional(),
          secondaryColor: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/)
            .optional(),
          backgroundColor: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/)
            .optional(),
          textColor: z
            .string()
            .regex(/^#[0-9A-Fa-f]{6}$/)
            .optional(),
          fontFamily: z.string().max(128).optional(),
          borderRadius: z.string().max(16).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...branding } = input;
        await db.updateMerchant(id, {
          brandingLogo: branding.logo,
          brandingPrimaryColor: branding.primaryColor,
          brandingSecondaryColor: branding.secondaryColor,
          brandingBackgroundColor: branding.backgroundColor,
          brandingTextColor: branding.textColor,
          brandingFontFamily: branding.fontFamily,
          brandingBorderRadius: branding.borderRadius,
        });
        return { success: true };
      }),

    // Generate preview session for branding
    generatePreviewSession: merchantProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const merchant = await db.getMerchantById(input.id);
        if (!merchant) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Merchant not found",
          });
        }

        const previewId = `preview_${randomBytes(16).toString("hex")}`;
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        const brandingData = {
          logo: merchant.brandingLogo,
          primaryColor: merchant.brandingPrimaryColor,
          secondaryColor: merchant.brandingSecondaryColor,
          backgroundColor: merchant.brandingBackgroundColor,
          textColor: merchant.brandingTextColor,
          fontFamily: merchant.brandingFontFamily,
          borderRadius: merchant.brandingBorderRadius,
        };

        const database = await db.getDb();
        if (!database) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Database unavailable",
          });
        }

        await database.insert(previewSessions).values({
          previewId,
          merchantId: merchant.id,
          brandingData: JSON.stringify(brandingData),
          expiresAt,
        });

        return {
          previewId,
          previewUrl: `/preview/${previewId}`,
          expiresAt,
        };
      }),
  }),

  // Preview session for branding
  preview: router({
    getSession: publicProcedure
      .input(z.object({ previewId: z.string() }))
      .query(async ({ input }) => {
        const database = await db.getDb();
        if (!database) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Database unavailable",
          });
        }

        const result = await database
          .select()
          .from(previewSessions)
          .where(eq(previewSessions.previewId, input.previewId))
          .limit(1);

        if (result.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Preview session not found",
          });
        }

        const session = result[0];

        // Check if expired
        if (new Date() > session.expiresAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Preview session expired",
          });
        }

        return {
          branding: JSON.parse(session.brandingData),
          expiresAt: session.expiresAt,
        };
      }),
  }),

  // Payment session management
  payment: router({
    // Create payment session (called by merchant backend via API)
    createSession: publicProcedure
      .input(
        z.object({
          apiKey: z.string(),
          amount: z.number().int().positive(),
          currency: z.string().length(3).default("USD"),
          description: z.string().optional(),
          customerEmail: z.string().email().optional(),
          customerName: z.string().optional(),
          customerPhone: z.string().optional(),
          merchantReference: z.string().optional(),
          successUrl: z.string().url().optional(),
          cancelUrl: z.string().url().optional(),
          metadata: z.record(z.string(), z.any()).optional(),
        })
      )
      .mutation(async ({ input }) => {
        // Verify API key
        const merchant = await db.getMerchantByApiKey(input.apiKey);
        if (!merchant) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid API key",
          });
        }

        if (merchant.status !== "active") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Merchant account not active",
          });
        }

        const sessionId = generateId("ps");
        const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

        const session = await db.createPaymentSession({
          sessionId,
          merchantId: merchant.id,
          amount: input.amount,
          currency: input.currency,
          description: input.description || null,
          customerEmail: input.customerEmail || null,
          customerName: input.customerName || null,
          customerPhone: input.customerPhone || null,
          merchantReference: input.merchantReference || null,
          successUrl: input.successUrl || null,
          cancelUrl: input.cancelUrl || null,
          metadata: input.metadata ? JSON.stringify(input.metadata) : null,
          expiresAt,
          status: "pending",
          paymentMethod: null,
        });

        return {
          sessionId: session.sessionId,
          checkoutUrl: `/checkout/${session.sessionId}`,
          expiresAt: session.expiresAt,
        };
      }),

    // Get session details (for checkout page)
    getSession: publicProcedure
      .input(z.object({ sessionId: z.string() }))
      .query(async ({ input }) => {
        const session = await db.getPaymentSessionBySessionId(input.sessionId);
        if (!session) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Payment session not found",
          });
        }

        // Check if expired
        if (new Date() > session.expiresAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payment session expired",
          });
        }

        const merchant = await db.getMerchantById(session.merchantId);

        return {
          ...session,
          merchantName: merchant?.businessName,
        };
      }),

    // Process payment (submit card details)
    processPayment: publicProcedure
      .input(
        z.object({
          sessionId: z.string(),
          paymentMethod: z.enum(["card", "bank_transfer", "qr_code", "wallet"]),
          // Card details (in production, use tokenization)
          cardNumber: z.string().optional(),
          cardExpiry: z.string().optional(),
          cardCvc: z.string().optional(),
          cardholderName: z.string().optional(),
          // Crypto details
          cryptoCurrency: z.enum(["BTC", "ETH", "USDT"]).optional(),
          // Wallet details
          walletType: z.enum(["paypal", "apple_pay", "google_pay"]).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const session = await db.getPaymentSessionBySessionId(input.sessionId);
        if (!session) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Payment session not found",
          });
        }

        if (session.status !== "pending") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payment session already processed",
          });
        }

        if (new Date() > session.expiresAt) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Payment session expired",
          });
        }

        // Update session with payment method
        await db.updatePaymentSession(input.sessionId, {
          paymentMethod: input.paymentMethod,
          status: "processing",
        });

        // Create transaction
        const transactionId = generateId("txn");

        // Payment submitted to gateway; actual result determined by provider callback.
        const isSuccess = true;
        const fraudScore = 0;
        const fraudStatus = "approved";

        // Determine status based on payment method
        let finalStatus:
          | "pending"
          | "authorized"
          | "captured"
          | "failed"
          | "refunded"
          | "partially_refunded" = "captured";
        let requiresManualConfirmation = false;

        if (input.paymentMethod === "bank_transfer") {
          finalStatus = "pending";
          requiresManualConfirmation = true;
        } else if (input.paymentMethod === "qr_code") {
          finalStatus = "pending";
          requiresManualConfirmation = true;
        } else if (input.paymentMethod === "wallet") {
          // Wallet payments would redirect to external provider
          finalStatus = "authorized"; // Use authorized for wallet payments pending confirmation
        } else if (!isSuccess || fraudStatus !== "approved") {
          finalStatus = "failed";
        }

        const transaction = await db.createTransaction({
          transactionId,
          sessionId: input.sessionId,
          merchantId: session.merchantId,
          amount: session.amount,
          currency: session.currency,
          status: finalStatus,
          paymentMethod: input.paymentMethod,
          cardLast4: input.cardNumber ? input.cardNumber.slice(-4) : null,
          cardBrand: input.cardNumber ? "visa" : null,
          gatewayTransactionId: `gw_${randomBytes(16).toString("hex")}`,
          gatewayResponse: JSON.stringify({
            success: isSuccess,
            cryptoCurrency: input.cryptoCurrency,
            walletType: input.walletType,
            requiresManualConfirmation,
          }) as any,
          fraudScore,
          fraudStatus,
          threeDSecureStatus: "not_required",
          platformFee: Math.floor(session.amount * 0.029), // 2.9% platform fee
          merchantFee: 0,
          errorCode: finalStatus === "failed" ? "card_declined" : null,
          errorMessage: finalStatus === "failed" ? "Card was declined" : null,
          processedAt: new Date(),
        });

        // Update session status
        await db.updatePaymentSession(input.sessionId, {
          status: transaction.status === "captured" ? "completed" : "failed",
        });

        // Send webhook to merchant
        const { sendWebhook } = await import("./webhooks");
        try {
          // Find merchant's webhook configuration
          const webhooks = await db.getWebhooksByMerchantId(session.merchantId);
          const activeWebhook = webhooks.find(
            (w: any) => w.enabled && w.events.includes("payment.completed")
          );

          if (activeWebhook) {
            await sendWebhook(
              activeWebhook.id,
              transaction.status === "captured"
                ? "payment.completed"
                : "payment.failed",
              {
                sessionId: input.sessionId,
                transactionId: transaction.transactionId,
                amount: transaction.amount,
                currency: transaction.currency,
                status: transaction.status,
                timestamp: new Date().toISOString(),
              }
            );
          }
        } catch (webhookError) {
          // Log webhook error but don't fail the payment
          log.error({ err: webhookError }, "[Payment] Webhook delivery failed");
        }

        return {
          transactionId: transaction.transactionId,
          status: transaction.status,
          redirectUrl:
            transaction.status === "captured"
              ? session.successUrl
              : session.cancelUrl,
        };
      }),

    // Get transaction details
    getTransaction: publicProcedure
      .input(z.object({ transactionId: z.string() }))
      .query(async ({ input }) => {
        const transaction = await db.getTransactionByTransactionId(
          input.transactionId
        );
        if (!transaction) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        }
        return transaction;
      }),

    // List merchant transactions
    listTransactions: merchantProcedure
      .input(z.object({ merchantId: z.number() }))
      .query(async ({ input }) => {
        return db.getTransactionsByMerchant(input.merchantId);
      }),

    // List merchant sessions
    listSessions: merchantProcedure
      .input(z.object({ merchantId: z.number() }))
      .query(async ({ input }) => {
        return db.getPaymentSessionsByMerchant(input.merchantId);
      }),
  }),

  // Refund operations
  refund: router({
    // Create refund
    create: merchantProcedure
      .input(
        z.object({
          transactionId: z.string(),
          amount: z.number().int().positive().optional(),
          reason: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const transaction = await db.getTransactionByTransactionId(
          input.transactionId
        );
        if (!transaction) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        }

        if (transaction.status !== "captured") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Can only refund captured transactions",
          });
        }

        // Calculate refund amount
        const existingRefunds = await db.getRefundsByTransaction(
          input.transactionId
        );
        const totalRefunded = existingRefunds.reduce(
          (sum, r) => (r.status === "completed" ? sum + r.amount : sum),
          0
        );
        const refundAmount = input.amount || transaction.amount - totalRefunded;

        if (refundAmount > transaction.amount - totalRefunded) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Refund amount exceeds available balance",
          });
        }

        const refundId = generateId("ref");
        const refund = await db.createRefund({
          refundId,
          transactionId: input.transactionId,
          merchantId: transaction.merchantId,
          amount: refundAmount,
          currency: transaction.currency,
          reason: input.reason || null,
          status: "completed", // Simulate instant refund
          gatewayRefundId: `gw_ref_${randomBytes(16).toString("hex")}`,
          processedAt: new Date(),
        });

        // Update transaction status
        const newTotalRefunded = totalRefunded + refundAmount;
        if (newTotalRefunded >= transaction.amount) {
          await db.updateTransaction(input.transactionId, {
            status: "refunded",
          });
        } else {
          await db.updateTransaction(input.transactionId, {
            status: "partially_refunded",
          });
        }

        return refund;
      }),

    // List refunds for transaction
    list: merchantProcedure
      .input(z.object({ transactionId: z.string() }))
      .query(async ({ input }) => {
        return db.getRefundsByTransaction(input.transactionId);
      }),
  }),
});

export type AppRouter = typeof appRouter;
