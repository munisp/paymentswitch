import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import {
  technicalConfigurations,
  securityCredentials,
  networkConfigurations,
  complianceDocuments,
  technicalOnboardingReviews,
} from "../../drizzle/schema";
import crypto from "crypto";
import https from "https";

/**
 * Validate SSL certificate
 */
export async function validateCertificate(certificate: string): Promise<{
  valid: boolean;
  expiryDate?: Date;
  issuer?: string;
  subject?: string;
  error?: string;
}> {
  try {
    // Parse PEM certificate
    const certRegex = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/;
    const match = certificate.match(certRegex);
    
    if (!match) {
      return { valid: false, error: "Invalid certificate format" };
    }

    // In production, use a proper certificate validation library
    // For now, we'll do basic validation
    const certData = match[0];
    
    const lines = certData.split('\n').filter(line => 
      !line.includes('BEGIN') && !line.includes('END') && line.trim()
    );
    
    if (lines.length === 0) {
      return { valid: false, error: "Empty certificate" };
    }

    // Parse X.509 certificate using Node.js crypto
    const x509 = new crypto.X509Certificate(certData);
    return {
      valid: new Date(x509.validTo) > new Date(),
      expiryDate: new Date(x509.validTo),
      issuer: x509.issuer,
      subject: x509.subject,
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Validation failed",
    };
  }
}

/**
 * Test endpoint connectivity
 */
export async function testEndpointConnectivity(endpoint: string): Promise<{
  reachable: boolean;
  responseTime?: number;
  statusCode?: number;
  error?: string;
}> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    try {
      const url = new URL(endpoint);
      
      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        timeout: 10000,
      };

      const req = https.request(options, (res) => {
        const responseTime = Date.now() - startTime;
        
        resolve({
          reachable: true,
          responseTime,
          statusCode: res.statusCode,
        });
        
        // Consume response to free up memory
        res.resume();
      });

      req.on('error', (error) => {
        resolve({
          reachable: false,
          error: error.message,
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          reachable: false,
          error: 'Connection timeout',
        });
      });

      req.end();
    } catch (error) {
      resolve({
        reachable: false,
        error: error instanceof Error ? error.message : 'Invalid endpoint',
      });
    }
  });
}

/**
 * Generate API key for participant
 */
export function generateApiKey(): string {
  return `pk_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Save technical configuration
 */
export async function saveTechnicalConfig(
  applicationId: number,
  userId: number,
  config: {
    primaryEndpoint?: string;
    backupEndpoint?: string;
    webhookUrl?: string;
    ipWhitelist?: string[];
    transactionCapacity?: number;
    supportedFormats?: string[];
    protocols?: string[];
    characterEncoding?: string;
    timezone?: string;
    operatingHours?: any;
    maintenanceWindows?: any;
    settlementCutoffTime?: string;
    minTransactionAmount?: number;
    maxTransactionAmount?: number;
    dailyTransactionLimit?: number;
    velocityLimit?: number;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(technicalConfigurations)
    .where(eq(technicalConfigurations.applicationId, applicationId))
    .limit(1);

  const data = {
    applicationId,
    userId,
    primaryEndpoint: config.primaryEndpoint,
    backupEndpoint: config.backupEndpoint,
    webhookUrl: config.webhookUrl,
    ipWhitelist: config.ipWhitelist ? JSON.stringify(config.ipWhitelist) : null,
    transactionCapacity: config.transactionCapacity,
    supportedFormats: config.supportedFormats ? JSON.stringify(config.supportedFormats) : null,
    protocols: config.protocols ? JSON.stringify(config.protocols) : null,
    characterEncoding: config.characterEncoding,
    timezone: config.timezone,
    operatingHours: config.operatingHours ? JSON.stringify(config.operatingHours) : null,
    maintenanceWindows: config.maintenanceWindows ? JSON.stringify(config.maintenanceWindows) : null,
    settlementCutoffTime: config.settlementCutoffTime,
    minTransactionAmount: config.minTransactionAmount,
    maxTransactionAmount: config.maxTransactionAmount,
    dailyTransactionLimit: config.dailyTransactionLimit,
    velocityLimit: config.velocityLimit,
  };

  if (existing.length > 0) {
    await db
      .update(technicalConfigurations)
      .set(data)
      .where(eq(technicalConfigurations.id, existing[0].id));
    return existing[0].id;
  } else {
    const [ins] = await db.insert(technicalConfigurations).values(data).returning({ id: technicalConfigurations.id });
    return ins.id;
  }
}

/**
 * Save security credentials
 */
export async function saveSecurityCredentials(
  applicationId: number,
  userId: number,
  credentials: {
    sslCertificate?: string;
    certificateChain?: string;
    certificateExpiry?: Date;
    apiKey?: string;
    oauthClientId?: string;
    oauthClientSecret?: string;
    jwtPublicKey?: string;
    publicKey?: string;
    pgpKeyId?: string;
    hsmEnabled?: boolean;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(securityCredentials)
    .where(eq(securityCredentials.applicationId, applicationId))
    .limit(1);

  const data = {
    applicationId,
    userId,
    ...credentials,
  };

  if (existing.length > 0) {
    await db
      .update(securityCredentials)
      .set(data)
      .where(eq(securityCredentials.id, existing[0].id));
    return existing[0].id;
  } else {
    const [ins] = await db.insert(securityCredentials).values(data).returning({ id: securityCredentials.id });
    return ins.id;
  }
}

/**
 * Save network configuration
 */
export async function saveNetworkConfig(
  applicationId: number,
  userId: number,
  config: {
    vpnRequired?: boolean;
    vpnType?: string;
    vpnEndpoint?: string;
    loadBalancerEndpoint?: string;
    healthCheckUrl?: string;
    timeoutSeconds?: number;
    retryPolicy?: any;
    topologyDiagramUrl?: string;
    firewallRulesDoc?: string;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const existing = await db
    .select()
    .from(networkConfigurations)
    .where(eq(networkConfigurations.applicationId, applicationId))
    .limit(1);

  const { retryPolicy: rp, ...rest } = config;
  const data = {
    applicationId,
    userId,
    ...rest,
    retryPolicy: rp ? JSON.stringify(rp) : null,
  };

  if (existing.length > 0) {
    await db
      .update(networkConfigurations)
      .set(data)
      .where(eq(networkConfigurations.id, existing[0].id));
    return existing[0].id;
  } else {
    const [ins] = await db.insert(networkConfigurations).values(data).returning({ id: networkConfigurations.id });
    return ins.id;
  }
}

/**
 * Upload compliance document
 */
export async function uploadComplianceDocument(
  applicationId: number,
  userId: number,
  document: {
    documentType: string;
    documentUrl: string;
    documentName: string;
    expiryDate?: Date;
    dataStorageLocation?: string;
    crossBorderTransfer?: boolean;
    gdprCompliant?: boolean;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [ins] = await db.insert(complianceDocuments).values({
    applicationId,
    userId,
    ...document,
  }).returning({ id: complianceDocuments.id });

  return ins.id;
}

/**
 * Get technical onboarding data
 */
export async function getTechnicalOnboarding(applicationId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [config] = await db
    .select()
    .from(technicalConfigurations)
    .where(eq(technicalConfigurations.applicationId, applicationId))
    .limit(1);

  const [credentials] = await db
    .select()
    .from(securityCredentials)
    .where(eq(securityCredentials.applicationId, applicationId))
    .limit(1);

  const [network] = await db
    .select()
    .from(networkConfigurations)
    .where(eq(networkConfigurations.applicationId, applicationId))
    .limit(1);

  const documents = await db
    .select()
    .from(complianceDocuments)
    .where(eq(complianceDocuments.applicationId, applicationId));

  return {
    configuration: config || null,
    credentials: credentials || null,
    network: network || null,
    documents: documents || [],
  };
}

/**
 * Submit technical onboarding for review
 */
export async function submitForReview(applicationId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Update status to submitted
  await db
    .update(technicalConfigurations)
    .set({ status: "submitted" })
    .where(eq(technicalConfigurations.applicationId, applicationId));

  // Create review record
  const [revIns] = await db.insert(technicalOnboardingReviews).values({
    configurationId: 0,
    applicationId,
    reviewerId: 0, // Will be assigned by admin
    status: "pending",
  }).returning({ id: technicalOnboardingReviews.id });

  return { success: true, reviewId: revIns.id };
}

/**
 * Admin: Get pending reviews
 */
export async function getPendingReviews() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const reviews = await db
    .select()
    .from(technicalOnboardingReviews)
    .where(eq(technicalOnboardingReviews.status, "pending"));

  return reviews;
}

/**
 * Admin: Review technical onboarding
 */
export async function reviewTechnicalOnboarding(
  reviewId: number,
  reviewerId: number,
  decision: {
    status: "approved" | "rejected" | "corrections_requested";
    endpointConnectivityTest?: boolean;
    certificateValidation?: boolean;
    complianceVerification?: boolean;
    comments?: string;
    correctionsRequired?: string[];
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(technicalOnboardingReviews)
    .set({
      reviewerId,
      status: decision.status,
      endpointConnectivityTest: decision.endpointConnectivityTest,
      tlsCertificateValid: decision.certificateValidation,
      comments: decision.comments,
      correctionsRequired: decision.correctionsRequired
        ? JSON.stringify(decision.correctionsRequired)
        : null,
      reviewedAt: new Date(),
    })
    .where(eq(technicalOnboardingReviews.id, reviewId));

  // Update application status
  const [review] = await db
    .select()
    .from(technicalOnboardingReviews)
    .where(eq(technicalOnboardingReviews.id, reviewId))
    .limit(1);

  if (review) {
    // Map review status to configuration status
    const configStatus = decision.status === 'corrections_requested' ? 'draft' : decision.status;
    await db
      .update(technicalConfigurations)
      .set({ status: configStatus as any })
      .where(eq(technicalConfigurations.applicationId, review.applicationId!));
  }

  return { success: true };
}
