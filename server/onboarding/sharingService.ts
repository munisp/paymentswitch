import { eq } from "drizzle-orm";
import { getDb } from "../db";
import { savedComparisons } from "../../drizzle/schema";
import crypto from "crypto";

/**
 * Generate a unique share token
 */
function generateShareToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * Enable sharing for a saved comparison
 */
export async function enableSharing(id: number, credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const shareToken = generateShareToken();

  await db
    .update(savedComparisons)
    .set({
      shareToken,
      isPublic: true,
      sharedAt: new Date(),
    })
    .where(eq(savedComparisons.id, id));

  return { shareToken };
}

/**
 * Disable sharing for a saved comparison
 */
export async function disableSharing(id: number, credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(savedComparisons)
    .set({
      shareToken: null,
      isPublic: false,
      sharedAt: null,
    })
    .where(eq(savedComparisons.id, id));

  return { success: true };
}

/**
 * Get a shared comparison by token (public access)
 */
export async function getSharedComparison(shareToken: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(savedComparisons)
    .where(eq(savedComparisons.shareToken, shareToken))
    .limit(1);

  if (result.length === 0 || !result[0].isPublic) {
    throw new Error("Shared comparison not found or not public");
  }

  const comparison = result[0];
  
  // Increment scan count and update last scanned timestamp
  await db
    .update(savedComparisons)
    .set({
      scanCount: (comparison.scanCount || 0) + 1,
      lastScannedAt: new Date(),
    })
    .where(eq(savedComparisons.id, comparison.id));

  return {
    ...comparison,
    scanCount: (comparison.scanCount || 0) + 1,
    tags: comparison.tags ? JSON.parse(comparison.tags as string) : [],
  };
}
