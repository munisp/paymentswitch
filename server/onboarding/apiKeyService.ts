import { randomBytes, createHash } from "crypto";
import { getDb } from "../db";
import { apiCredentials, apiKeyHistory, integrationEnvironments } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

/**
 * Generate a secure random API key
 */
export function generateSecureKey(prefix: string = "sk"): string {
  const randomPart = randomBytes(32).toString("hex");
  return `${prefix}_${randomPart}`;
}

/**
 * Generate a secure API secret
 */
export function generateSecureSecret(): string {
  return randomBytes(48).toString("hex");
}

/**
 * Hash an API key for storage (one-way hash for validation)
 */
export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

/**
 * Generate new API credentials for an environment
 */
export async function generateApiKey(params: {
  environmentId: number;
  createdBy: number;
  expiresInDays?: number;
}): Promise<{
  apiKey: string;
  apiSecret: string;
  credentialId: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get environment to determine key prefix
  const [environment] = await db
    .select()
    .from(integrationEnvironments)
    .where(eq(integrationEnvironments.id, params.environmentId))
    .limit(1);

  if (!environment) {
    throw new Error("Environment not found");
  }

  // Generate prefix based on environment type
  const prefix = environment.environmentType === "production" ? "pk" : "sk";
  
  // Generate credentials
  const apiKey = generateSecureKey(prefix);
  const apiSecret = generateSecureSecret();

  // Calculate expiration
  const expiresAt = params.expiresInDays
    ? new Date(Date.now() + params.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  // Get current max version for this environment
  const [maxVersion] = await db
    .select({ maxVersion: apiCredentials.keyVersion })
    .from(apiCredentials)
    .where(eq(apiCredentials.environmentId, params.environmentId))
    .orderBy(apiCredentials.keyVersion)
    .limit(1);

  const keyVersion = (maxVersion?.maxVersion || 0) + 1;

  // Insert new credential
  const [inserted] = await db.insert(apiCredentials).values({
    environmentId: params.environmentId,
    apiKey,
    apiSecret,
    keyVersion,
    isActive: true,
    expiresAt,
    createdBy: params.createdBy,
  }).returning({ id: apiCredentials.id });

  const credentialId = inserted.id;

  // Log to history
  await db.insert(apiKeyHistory).values({
    apiKeyId: credentialId,
    credentialId,
    action: "created",
    performedBy: params.createdBy,
    reason: "Initial key generation",
  });

  return {
    apiKey,
    apiSecret,
    credentialId,
  };
}

/**
 * Rotate an existing API key (create new, deactivate old)
 */
export async function rotateApiKey(params: {
  credentialId: number;
  performedBy: number;
  reason?: string;
  expiresInDays?: number;
}): Promise<{
  apiKey: string;
  apiSecret: string;
  newCredentialId: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get existing credential
  const [oldCredential] = await db
    .select()
    .from(apiCredentials)
    .where(eq(apiCredentials.id, params.credentialId))
    .limit(1);

  if (!oldCredential) {
    throw new Error("Credential not found");
  }

  if (!oldCredential.isActive) {
    throw new Error("Cannot rotate inactive credential");
  }

  // Generate new credentials
  const newCreds = await generateApiKey({
    environmentId: oldCredential.environmentId,
    createdBy: params.performedBy,
    expiresInDays: params.expiresInDays,
  });

  // Deactivate old credential
  await db
    .update(apiCredentials)
    .set({
      isActive: false,
      revokedBy: params.performedBy,
      revokedAt: new Date(),
      revocationReason: params.reason || "Rotated to new key",
    })
    .where(eq(apiCredentials.id, params.credentialId));

  // Log rotation
  await db.insert(apiKeyHistory).values({
    apiKeyId: params.credentialId,
    credentialId: params.credentialId,
    action: "rotated",
    performedBy: params.performedBy,
    reason: params.reason || "Key rotation",
  });

  return {
    apiKey: newCreds.apiKey,
    apiSecret: newCreds.apiSecret,
    newCredentialId: newCreds.credentialId,
  };
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(params: {
  credentialId: number;
  performedBy: number;
  reason: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Get credential
  const [credential] = await db
    .select()
    .from(apiCredentials)
    .where(eq(apiCredentials.id, params.credentialId))
    .limit(1);

  if (!credential) {
    throw new Error("Credential not found");
  }

  if (!credential.isActive) {
    throw new Error("Credential already revoked");
  }

  // Revoke
  await db
    .update(apiCredentials)
    .set({
      isActive: false,
      revokedBy: params.performedBy,
      revokedAt: new Date(),
      revocationReason: params.reason,
    })
    .where(eq(apiCredentials.id, params.credentialId));

  // Log revocation
  await db.insert(apiKeyHistory).values({
    apiKeyId: params.credentialId,
    credentialId: params.credentialId,
    action: "revoked",
    performedBy: params.performedBy,
    reason: params.reason,
  });
}

/**
 * Validate an API key
 */
export async function validateApiKey(apiKey: string): Promise<{
  valid: boolean;
  credentialId?: number;
  environmentId?: number;
  environmentType?: string;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Find credential by API key
  const [credential] = await db
    .select()
    .from(apiCredentials)
    .where(eq(apiCredentials.apiKey, apiKey))
    .limit(1);

  if (!credential) {
    return { valid: false };
  }

  // Check if active
  if (!credential.isActive) {
    return { valid: false };
  }

  // Check expiration
  if (credential.expiresAt && credential.expiresAt < new Date()) {
    // Mark as expired
    await db
      .update(apiCredentials)
      .set({ isActive: false })
      .where(eq(apiCredentials.id, credential.id));

    await db.insert(apiKeyHistory).values({
      apiKeyId: credential.id,
      credentialId: credential.id,
      action: "expired",
      reason: "Key expired",
    });

    return { valid: false };
  }

  // Update last used timestamp
  await db
    .update(apiCredentials)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiCredentials.id, credential.id));

  // Get environment info
  const [environment] = await db
    .select()
    .from(integrationEnvironments)
    .where(eq(integrationEnvironments.id, credential.environmentId))
    .limit(1);

  return {
    valid: true,
    credentialId: credential.id,
    environmentId: credential.environmentId,
    environmentType: environment?.environmentType,
  };
}

/**
 * List all API keys for an environment
 */
export async function listApiKeys(environmentId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const credentials = await db
    .select()
    .from(apiCredentials)
    .where(eq(apiCredentials.environmentId, environmentId))
    .orderBy(apiCredentials.createdAt);

  return credentials.map((cred) => ({
    id: cred.id,
    keyVersion: cred.keyVersion,
    isActive: cred.isActive,
    expiresAt: cred.expiresAt,
    lastUsedAt: cred.lastUsedAt,
    createdAt: cred.createdAt,
    revokedAt: cred.revokedAt,
    revocationReason: cred.revocationReason,
    // Never return actual keys in list
    apiKeyPreview: cred.apiKey.substring(0, 12) + "..." + cred.apiKey.substring(cred.apiKey.length - 4),
  }));
}

/**
 * Get API key history for audit
 */
export async function getApiKeyHistory(credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  return await db
    .select()
    .from(apiKeyHistory)
    .where(eq(apiKeyHistory.credentialId, credentialId))
    .orderBy(apiKeyHistory.createdAt);
}
