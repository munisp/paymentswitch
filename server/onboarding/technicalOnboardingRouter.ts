import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import {
  technicalConfigurations,
  securityCredentials,
  networkConfigurations,
  complianceDocuments,
  technicalOnboardingReviews,
  participantApplications,
  onboardingDrafts,
  multipartUploadSessions,
} from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { TRPCError } from "@trpc/server";
import {
  context,
  propagation,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import {
  recordDraftConflict,
  recordDraftSave,
  recordMultipartAborted,
  recordMultipartCompleted,
  recordMultipartStarted,
} from "../observability/metrics";
import {
  abortMultipartUpload,
  completeMultipartUpload,
  createMultipartUpload,
  multipartPartSize,
  presignMultipartPart,
} from "../storageMultipart";
import {
  testEndpointConnectivity,
  validateCertificate,
  validateURL,
  validateIPAddress,
  validateTransactionLimits,
  generateAPIKey,
  testHealthCheck,
} from "./technicalValidationService";
import { notifyAdminsOfNewSubmission } from "../services/notificationService";
import { storagePut } from "../storage";
import { createChildLogger } from "../lib/logger";
import { enforceMultipartInitiationRateLimit } from "../security/distributedMultipartRateLimiter";

const log = createChildLogger("technicalOnboarding");
const tracer = trace.getTracer("paymentswitch-onboarding");

export const technicalOnboardingRouter = router({
  saveDraft: protectedProcedure
    .input(
      z.object({
        currentStep: z.number().int().min(1).max(5),
        formData: z.record(z.string(), z.unknown()),
        documentManifest: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(255),
              key: z.string().trim().min(1).max(512),
              url: z.string().url(),
              size: z.number().int().nonnegative(),
              contentType: z.string().max(128),
              uploadedAt: z.string().datetime(),
            })
          )
          .max(100),
        version: z.number().int().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database not available");
      const now = new Date();
      return database.transaction(async tx => {
        const existing = await tx
          .select({
            id: onboardingDrafts.id,
            version: onboardingDrafts.version,
          })
          .from(onboardingDrafts)
          .where(eq(onboardingDrafts.userId, ctx.user.id))
          .for("update")
          .limit(1);
        if (
          existing[0] &&
          input.version !== undefined &&
          input.version !== existing[0].version
        ) {
          recordDraftConflict();
          throw new TRPCError({
            code: "CONFLICT",
            message: "Draft has changed elsewhere; reload before saving",
          });
        }
        const nextVersion = (existing[0]?.version ?? 0) + 1;
        if (existing[0]) {
          const [draft] = await tx
            .update(onboardingDrafts)
            .set({
              currentStep: input.currentStep,
              formData: input.formData,
              documentManifest: input.documentManifest,
              version: nextVersion,
              updatedAt: now,
            })
            .where(eq(onboardingDrafts.id, existing[0].id))
            .returning();
          if (!draft) throw new Error("Draft was not persisted");
          recordDraftSave();
          return draft;
        }
        const [draft] = await tx
          .insert(onboardingDrafts)
          .values({
            userId: ctx.user.id,
            currentStep: input.currentStep,
            formData: input.formData,
            documentManifest: input.documentManifest,
            version: nextVersion,
            updatedAt: now,
          })
          .returning();
        if (!draft) throw new Error("Draft was not persisted");
        recordDraftSave();
        return draft;
      });
    }),

  getDraft: protectedProcedure.query(async ({ ctx }) => {
    const database = await getDb();
    if (!database) throw new Error("Database not available");
    const [draft] = await database
      .select()
      .from(onboardingDrafts)
      .where(eq(onboardingDrafts.userId, ctx.user.id))
      .limit(1);
    return draft ?? null;
  }),

  initiateMultipartUpload: protectedProcedure
    .input(
      z.object({
        documentLabel: z.string().trim().min(1).max(255),
        fileName: z.string().trim().min(1).max(255),
        contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
        size: z
          .number()
          .int()
          .positive()
          .max(500 * 1024 * 1024),
      })
    )
    .mutation(async ({ ctx, input }) =>
      tracer.startActiveSpan("onboarding.multipart.initiate", async span => {
        try {
          await enforceMultipartInitiationRateLimit({
            userId: ctx.user.id,
            clientIp: ctx.req.ip,
          });
          const carrier: Record<string, string> = {};
          propagation.inject(context.active(), carrier);
          const upload = await createMultipartUpload({
            userId: ctx.user.id,
            ...input,
          });
          const database = await getDb();
          if (!database) throw new Error("Database not available");
          await database.insert(multipartUploadSessions).values({
            userId: ctx.user.id,
            uploadId: upload.uploadId,
            objectKey: upload.key,
            traceparent: carrier.traceparent ?? null,
            documentLabel: input.documentLabel,
            originalFileName: input.fileName,
            contentType: input.contentType,
            sizeBytes: input.size,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          });
          span.setAttributes({
            "onboarding.document_label": input.documentLabel,
            "onboarding.file_size_bytes": input.size,
            "onboarding.trace_context_persisted": Boolean(carrier.traceparent),
          });
          span.setStatus({ code: SpanStatusCode.OK });
          recordMultipartStarted();
          return upload;
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      })
    ),

  presignMultipartPart: protectedProcedure
    .input(
      z.object({
        uploadId: z.string().min(1).max(512),
        key: z.string().min(1).max(1024),
        partNumber: z.number().int().min(1).max(10000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.key.startsWith(`onboarding/${ctx.user.id}/documents/`))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Upload key is not owned by the current user",
        });
      return { url: await presignMultipartPart(input) };
    }),

  completeMultipartUpload: protectedProcedure
    .input(
      z.object({
        uploadId: z.string().min(1).max(512),
        key: z.string().min(1).max(1024),
        documentLabel: z.string().trim().min(1).max(255),
        originalFileName: z.string().trim().min(1).max(255),
        contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
        size: z
          .number()
          .int()
          .positive()
          .max(500 * 1024 * 1024),
        parts: z
          .array(
            z.object({
              partNumber: z.number().int().min(1).max(10000),
              etag: z.string().min(1).max(256),
            })
          )
          .min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.key.startsWith(`onboarding/${ctx.user.id}/documents/`))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Upload key is not owned by the current user",
        });
      const completed = await completeMultipartUpload(input);
      const database = await getDb();
      if (!database) throw new Error("Database not available");
      await database
        .update(multipartUploadSessions)
        .set({ status: "completed", completedAt: new Date() })
        .where(
          and(
            eq(multipartUploadSessions.uploadId, input.uploadId),
            eq(multipartUploadSessions.userId, ctx.user.id)
          )
        );
      recordMultipartCompleted();
      return {
        name: input.documentLabel,
        originalFileName: input.originalFileName,
        key: completed.key,
        url: "",
        size: input.size,
        contentType: input.contentType,
        uploadedAt: new Date().toISOString(),
        partSize: multipartPartSize(),
      };
    }),

  abortMultipartUpload: protectedProcedure
    .input(
      z.object({
        uploadId: z.string().min(1).max(512),
        key: z.string().min(1).max(1024),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!input.key.startsWith(`onboarding/${ctx.user.id}/documents/`))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Upload key is not owned by the current user",
        });
      await abortMultipartUpload(input);
      const database = await getDb();
      if (!database) throw new Error("Database not available");
      await database
        .update(multipartUploadSessions)
        .set({ status: "aborted", abortedAt: new Date() })
        .where(
          and(
            eq(multipartUploadSessions.uploadId, input.uploadId),
            eq(multipartUploadSessions.userId, ctx.user.id)
          )
        );
      recordMultipartAborted("client_or_timeout");
      return { aborted: true };
    }),

  uploadDocument: protectedProcedure
    .input(
      z.object({
        documentLabel: z.string().trim().min(1).max(255),
        fileName: z.string().trim().min(1).max(255),
        contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
        size: z
          .number()
          .int()
          .positive()
          .max(10 * 1024 * 1024),
        base64: z.string().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const encoded = input.base64.replace(/^data:[^;]+;base64,/, "");
      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length !== input.size || bytes.length > 10 * 1024 * 1024) {
        throw new Error("Uploaded document size is invalid");
      }
      const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const key = `onboarding/${ctx.user.id}/documents/${randomUUID()}-${safeName}`;
      const uploaded = await storagePut(key, bytes, input.contentType);
      return {
        name: input.documentLabel,
        originalFileName: input.fileName,
        key: uploaded.key,
        url: uploaded.url,
        size: bytes.length,
        contentType: input.contentType,
        uploadedAt: new Date().toISOString(),
      };
    }),

  createParticipantApplication: protectedProcedure
    .input(
      z.object({
        formData: z.object({
          organizationName: z.string().trim().min(1).max(255),
          stakeholderType: z.string().trim().min(1).max(100),
          registrationNumber: z.string().trim().max(100),
          taxId: z.string().trim().max(100),
          country: z.string().trim().min(1).max(100),
          address: z.string().trim().min(1).max(2000),
          website: z.string().trim().url().or(z.literal("")),
          description: z.string().trim().max(4000),
          contactName: z.string().trim().min(1).max(255),
          contactEmail: z.string().trim().email().max(320),
          contactPhone: z.string().trim().min(3).max(32),
          contactTitle: z.string().trim().min(1).max(255),
          apiEndpoint: z.string().trim().url(),
          callbackUrl: z.string().trim().url(),
          ipWhitelist: z.string().trim().max(4000),
          preferredEnvironment: z.enum(["sandbox", "staging", "production"]),
        }),
        documentManifest: z
          .array(
            z.object({
              name: z.string().trim().min(1).max(255),
              size: z.number().int().nonnegative().optional(),
              contentType: z.string().max(128).optional(),
              storageKey: z.string().max(512).optional(),
            })
          )
          .max(100),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const database = await getDb();
      if (!database) throw new Error("Database not available");
      const data = input.formData;
      const [application] = await database
        .insert(participantApplications)
        .values({
          userId: ctx.user.id,
          organizationName: data.organizationName,
          organizationType: data.stakeholderType,
          registrationNumber: data.registrationNumber || null,
          taxId: data.taxId || null,
          primaryContactName: data.contactName,
          primaryContactEmail: data.contactEmail,
          primaryContactPhone: data.contactPhone,
          contactName: data.contactName,
          contactEmail: data.contactEmail,
          businessType: data.description || data.stakeholderType,
          address: data.address,
          country: data.country,
          submissionPayload: data,
          documentManifest: input.documentManifest,
          status: "submitted",
          currentStage: "kyb",
          submittedAt: new Date(),
        })
        .returning();
      if (!application) throw new Error("Application was not persisted");
      return {
        id: application.id,
        reference: `APP-${application.id}`,
        status: application.status,
      };
    }),

  // Save technical configuration
  saveTechnicalConfig: protectedProcedure
    .input(
      z.object({
        applicationId: z.number(),
        primaryEndpoint: z.string().url().optional(),
        backupEndpoint: z.string().url().optional(),
        webhookUrl: z.string().url().optional(),
        ipWhitelist: z.array(z.string()).optional(),
        transactionCapacity: z.number().optional(),
        supportedFormats: z.array(z.string()).optional(),
        protocols: z.array(z.string()).optional(),
        characterEncoding: z.string().optional(),
        timezone: z.string().optional(),
        operatingHours: z.any().optional(),
        maintenanceWindows: z.any().optional(),
        settlementCutoffTime: z.string().optional(),
        minTransactionAmount: z.number().optional(),
        maxTransactionAmount: z.number().optional(),
        dailyTransactionLimit: z.number().optional(),
        velocityLimit: z.number().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Validate transaction limits if provided
      if (
        input.minTransactionAmount &&
        input.maxTransactionAmount &&
        input.dailyTransactionLimit
      ) {
        const validation = validateTransactionLimits(
          input.minTransactionAmount,
          input.maxTransactionAmount,
          input.dailyTransactionLimit
        );
        if (!validation.valid) {
          throw new Error(validation.error);
        }
      }

      // Check if config already exists
      const existing = await db
        .select()
        .from(technicalConfigurations)
        .where(
          and(
            eq(technicalConfigurations.applicationId, input.applicationId),
            eq(technicalConfigurations.userId, ctx.user.id)
          )
        )
        .limit(1);

      const data = {
        applicationId: input.applicationId,
        userId: ctx.user.id,
        primaryEndpoint: input.primaryEndpoint || null,
        backupEndpoint: input.backupEndpoint || null,
        webhookUrl: input.webhookUrl || null,
        ipWhitelist: input.ipWhitelist
          ? JSON.stringify(input.ipWhitelist)
          : null,
        transactionCapacity: input.transactionCapacity || null,
        supportedFormats: input.supportedFormats
          ? JSON.stringify(input.supportedFormats)
          : null,
        protocols: input.protocols ? JSON.stringify(input.protocols) : null,
        characterEncoding: input.characterEncoding || null,
        timezone: input.timezone || null,
        operatingHours: input.operatingHours
          ? JSON.stringify(input.operatingHours)
          : null,
        maintenanceWindows: input.maintenanceWindows
          ? JSON.stringify(input.maintenanceWindows)
          : null,
        settlementCutoffTime: input.settlementCutoffTime || null,
        minTransactionAmount: input.minTransactionAmount || null,
        maxTransactionAmount: input.maxTransactionAmount || null,
        dailyTransactionLimit: input.dailyTransactionLimit || null,
        velocityLimit: input.velocityLimit || null,
      };

      if (existing.length > 0) {
        await db
          .update(technicalConfigurations)
          .set(data)
          .where(eq(technicalConfigurations.id, existing[0].id));
        return {
          id: existing[0].id,
          message: "Technical configuration updated",
        };
      } else {
        const [ins] = await db
          .insert(technicalConfigurations)
          .values(data)
          .returning({ id: technicalConfigurations.id });
        return { id: ins.id, message: "Technical configuration saved" };
      }
    }),

  // Test endpoint connectivity
  testEndpoint: protectedProcedure
    .input(
      z.object({
        endpoint: z.string().url(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await testEndpointConnectivity(input.endpoint);
      return result;
    }),

  // Save security credentials
  saveSecurityCredentials: protectedProcedure
    .input(
      z.object({
        applicationId: z.number(),
        sslCertificate: z.string().optional(),
        certificateChain: z.string().optional(),
        oauthClientId: z.string().optional(),
        oauthClientSecret: z.string().optional(),
        jwtPublicKey: z.string().optional(),
        publicKey: z.string().optional(),
        pgpKeyId: z.string().optional(),
        hsmEnabled: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Validate certificate if provided
      if (input.sslCertificate) {
        const validation = validateCertificate(input.sslCertificate);
        if (!validation.valid) {
          throw new Error(validation.error || "Invalid certificate");
        }
      }

      // Generate API key
      const apiKey = generateAPIKey();

      // Check if credentials already exist
      const existing = await db
        .select()
        .from(securityCredentials)
        .where(
          and(
            eq(securityCredentials.applicationId, input.applicationId),
            eq(securityCredentials.userId, ctx.user.id)
          )
        )
        .limit(1);

      const data = {
        applicationId: input.applicationId,
        userId: ctx.user.id,
        sslCertificate: input.sslCertificate || null,
        certificateChain: input.certificateChain || null,
        apiKey,
        oauthClientId: input.oauthClientId || null,
        oauthClientSecret: input.oauthClientSecret || null,
        jwtPublicKey: input.jwtPublicKey || null,
        publicKey: input.publicKey || null,
        pgpKeyId: input.pgpKeyId || null,
        hsmEnabled: input.hsmEnabled || false,
      };

      if (existing.length > 0) {
        await db
          .update(securityCredentials)
          .set(data)
          .where(eq(securityCredentials.id, existing[0].id));
        return {
          id: existing[0].id,
          apiKey,
          message: "Security credentials updated",
        };
      } else {
        const [ins] = await db
          .insert(securityCredentials)
          .values(data)
          .returning({ id: securityCredentials.id });
        return { id: ins.id, apiKey, message: "Security credentials saved" };
      }
    }),

  // Validate certificate
  validateCertificate: protectedProcedure
    .input(
      z.object({
        certificate: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const result = validateCertificate(input.certificate);
      return result;
    }),

  // Save network configuration
  saveNetworkConfig: protectedProcedure
    .input(
      z.object({
        applicationId: z.number(),
        vpnRequired: z.boolean().optional(),
        vpnType: z.string().optional(),
        vpnEndpoint: z.string().optional(),
        loadBalancerEndpoint: z.string().optional(),
        healthCheckUrl: z.string().optional(),
        timeoutSeconds: z.number().optional(),
        retryPolicy: z.any().optional(),
        topologyDiagramUrl: z.string().optional(),
        firewallRulesDoc: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Validate health check URL if provided
      if (input.healthCheckUrl) {
        const testResult = await testHealthCheck(input.healthCheckUrl);
        if (!testResult.success) {
          throw new Error(`Health check failed: ${testResult.error}`);
        }
      }

      // Check if config already exists
      const existing = await db
        .select()
        .from(networkConfigurations)
        .where(
          and(
            eq(networkConfigurations.applicationId, input.applicationId),
            eq(networkConfigurations.userId, ctx.user.id)
          )
        )
        .limit(1);

      const data = {
        applicationId: input.applicationId,
        userId: ctx.user.id,
        vpnRequired: input.vpnRequired || false,
        vpnType: input.vpnType || null,
        vpnEndpoint: input.vpnEndpoint || null,
        loadBalancerEndpoint: input.loadBalancerEndpoint || null,
        healthCheckUrl: input.healthCheckUrl || null,
        timeoutSeconds: input.timeoutSeconds || 30,
        retryPolicy: input.retryPolicy
          ? JSON.stringify(input.retryPolicy)
          : null,
        topologyDiagramUrl: input.topologyDiagramUrl || null,
        firewallRulesDoc: input.firewallRulesDoc || null,
      };

      if (existing.length > 0) {
        await db
          .update(networkConfigurations)
          .set(data)
          .where(eq(networkConfigurations.id, existing[0].id));
        return { id: existing[0].id, message: "Network configuration updated" };
      } else {
        const [ins] = await db
          .insert(networkConfigurations)
          .values(data)
          .returning({ id: networkConfigurations.id });
        return { id: ins.id, message: "Network configuration saved" };
      }
    }),

  // Upload compliance document
  uploadComplianceDoc: protectedProcedure
    .input(
      z.object({
        applicationId: z.number(),
        documentType: z.string(),
        documentName: z.string(),
        documentData: z.string(), // Base64 encoded
        expiryDate: z.string().optional(),
        dataStorageLocation: z.string().optional(),
        crossBorderTransfer: z.boolean().optional(),
        gdprCompliant: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Upload document to S3
      const buffer = Buffer.from(input.documentData, "base64");
      const fileKey = `compliance/${ctx.user.id}/${input.applicationId}/${Date.now()}-${input.documentName}`;

      const { url } = await storagePut(fileKey, buffer, "application/pdf");

      // Save document metadata
      const [docIns] = await db
        .insert(complianceDocuments)
        .values({
          applicationId: input.applicationId,
          userId: ctx.user.id,
          documentType: input.documentType,
          documentUrl: url,
          documentName: input.documentName,
          expiryDate: input.expiryDate ? new Date(input.expiryDate) : null,
          dataStorageLocation: input.dataStorageLocation || null,
          crossBorderTransfer: input.crossBorderTransfer || false,
          gdprCompliant: input.gdprCompliant || false,
        })
        .returning({ id: complianceDocuments.id });

      return {
        id: docIns.id,
        url,
        message: "Compliance document uploaded successfully",
      };
    }),

  // Get technical onboarding data
  getTechnicalOnboarding: protectedProcedure
    .input(
      z.object({
        applicationId: z.number(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const [techConfig] = await db
        .select()
        .from(technicalConfigurations)
        .where(
          and(
            eq(technicalConfigurations.applicationId, input.applicationId),
            eq(technicalConfigurations.userId, ctx.user.id)
          )
        )
        .limit(1);

      const [secCreds] = await db
        .select()
        .from(securityCredentials)
        .where(
          and(
            eq(securityCredentials.applicationId, input.applicationId),
            eq(securityCredentials.userId, ctx.user.id)
          )
        )
        .limit(1);

      const [netConfig] = await db
        .select()
        .from(networkConfigurations)
        .where(
          and(
            eq(networkConfigurations.applicationId, input.applicationId),
            eq(networkConfigurations.userId, ctx.user.id)
          )
        )
        .limit(1);

      const compDocs = await db
        .select()
        .from(complianceDocuments)
        .where(
          and(
            eq(complianceDocuments.applicationId, input.applicationId),
            eq(complianceDocuments.userId, ctx.user.id)
          )
        );

      return {
        technicalConfig: techConfig || null,
        securityCredentials: secCreds || null,
        networkConfig: netConfig || null,
        complianceDocuments: compDocs,
      };
    }),

  // Submit for review
  submitForReview: protectedProcedure
    .input(
      z.object({
        applicationId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Update status to submitted
      await db
        .update(technicalConfigurations)
        .set({ status: "submitted" })
        .where(
          and(
            eq(technicalConfigurations.applicationId, input.applicationId),
            eq(technicalConfigurations.userId, ctx.user.id)
          )
        );

      // Create review record
      await db.insert(technicalOnboardingReviews).values({
        configurationId: 0,
        applicationId: input.applicationId,
        reviewerId: 0, // Will be assigned to admin
        status: "pending",
      });

      // Send notification to admins
      try {
        await notifyAdminsOfNewSubmission(
          input.applicationId,
          `Application ${input.applicationId}`
        );
      } catch (error) {
        log.error({ err: error }, "Failed to send admin notifications:");
        // Don't fail the submission if notifications fail
      }

      return { message: "Submitted for review successfully" };
    }),

  // Admin: List pending reviews
  listPendingReviews: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const reviews = await db.select().from(technicalOnboardingReviews);

    // Fetch related data for each review
    const enrichedReviews = await Promise.all(
      reviews.map(async review => {
        const appId = review.applicationId ?? 0;
        const [techConfig] = await db
          .select()
          .from(technicalConfigurations)
          .where(eq(technicalConfigurations.applicationId, appId))
          .limit(1);

        const [secCreds] = await db
          .select()
          .from(securityCredentials)
          .where(eq(securityCredentials.applicationId, appId))
          .limit(1);

        const [netConfig] = await db
          .select()
          .from(networkConfigurations)
          .where(eq(networkConfigurations.applicationId, appId))
          .limit(1);

        return {
          ...review,
          submittedAt: review.createdAt,
          organizationName: `Application ${appId}`,
          technicalConfig: techConfig || null,
          securityCreds: secCreds || null,
          networkConfig: netConfig || null,
          reviewComments: review.comments,
        };
      })
    );

    return enrichedReviews;
  }),

  // Admin: Review technical onboarding
  reviewTechnicalOnboarding: adminProcedure
    .input(
      z.object({
        reviewId: z.number(),
        status: z.enum(["approved", "rejected", "corrections_requested"]),
        comments: z.string().optional(),
        correctionsRequired: z.array(z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Update review
      await db
        .update(technicalOnboardingReviews)
        .set({
          status: input.status,
          reviewerId: ctx.user.id,
          comments: input.comments || null,
          correctionsRequired: input.correctionsRequired
            ? JSON.stringify(input.correctionsRequired)
            : null,
        })
        .where(eq(technicalOnboardingReviews.id, input.reviewId));

      // Update technical config status
      const [review] = await db
        .select()
        .from(technicalOnboardingReviews)
        .where(eq(technicalOnboardingReviews.id, input.reviewId))
        .limit(1);

      if (review) {
        await db
          .update(technicalConfigurations)
          .set({
            status:
              input.status === "approved"
                ? "approved"
                : input.status === "rejected"
                  ? "rejected"
                  : "draft",
          })
          .where(
            eq(technicalConfigurations.applicationId, review.applicationId ?? 0)
          );
      }

      // Send notification to participant
      try {
        const { notifyOwner } = await import("../_core/notification");
        const statusText =
          review.status === "approved" ? "approved" : "rejected";
        const message =
          review.status === "approved"
            ? `Your technical configuration has been approved. You can now proceed to the next step.`
            : `Your technical configuration has been rejected. Reason: ${review.reviewNotes || "Please review and resubmit."}`;

        await notifyOwner({
          title: `Technical Configuration ${statusText.charAt(0).toUpperCase() + statusText.slice(1)}`,
          content: message,
        });
      } catch (notificationError) {
        // Log notification error but don't fail the review
        log.error(
          { err: notificationError },
          "[TechnicalOnboarding] Notification delivery failed"
        );
      }

      return { message: "Review completed successfully" };
    }),
});
