import { eq, and, desc } from "drizzle-orm";
import { getDb } from "../db";
import { savedComparisons, InsertSavedComparison } from "../../drizzle/schema";

/**
 * Save a test comparison
 */
export async function saveComparison(data: Partial<InsertSavedComparison> & { name: string; tags?: string[] }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const insertData = {
    userId: data.userId ?? 0,
    fromCurrency: data.fromCurrency ?? 'USD',
    toCurrency: data.toCurrency ?? 'NGN',
    ...data,
    tags: data.tags ? JSON.stringify(data.tags) : null,
  };

  const [inserted] = await db.insert(savedComparisons).values(insertData).returning({ id: savedComparisons.id });

  return {
    id: inserted.id,
    success: true,
  };
}

/**
 * Get all saved comparisons for a credential
 */
export async function getSavedComparisons(credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const comparisons = await db
    .select()
    .from(savedComparisons)
    .where(eq(savedComparisons.credentialId, credentialId))
    .orderBy(desc(savedComparisons.createdAt));

  // Parse tags JSON
  return comparisons.map((c) => ({
    ...c,
    tags: c.tags ? JSON.parse(c.tags as string) : [],
  }));
}

/**
 * Get a single saved comparison
 */
export async function getSavedComparison(id: number, credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db
    .select()
    .from(savedComparisons)
    .where(
      and(
        eq(savedComparisons.id, id),
        eq(savedComparisons.credentialId, credentialId)
      )
    )
    .limit(1);

  if (result.length === 0) {
    throw new Error("Saved comparison not found");
  }

  const comparison = result[0];
  return {
    ...comparison,
    tags: comparison.tags ? JSON.parse(comparison.tags as string) : [],
  };
}

/**
 * Delete a saved comparison
 */
export async function deleteComparison(id: number, credentialId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .delete(savedComparisons)
    .where(
      and(
        eq(savedComparisons.id, id),
        eq(savedComparisons.credentialId, credentialId)
      )
    );

  return { success: true };
}

/**
 * Update tags for a saved comparison
 */
export async function updateComparisonTags(
  id: number,
  credentialId: number,
  tags: string[]
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(savedComparisons)
    .set({ tags: JSON.stringify(tags) })
    .where(
      and(
        eq(savedComparisons.id, id),
        eq(savedComparisons.credentialId, credentialId)
      )
    );

  return { success: true };
}
