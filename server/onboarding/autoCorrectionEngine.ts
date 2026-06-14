/**
 * Auto-Correction Engine
 * Applies learned correction patterns to OCR results
 */

import { getDb } from "../db";
import { ocrCorrectionPatterns, ocrCorrectionSettings } from "../../drizzle/schema";
import { eq, and } from "drizzle-orm";

interface CorrectionResult {
  originalValue: string;
  correctedValue: string;
  wasCorrected: boolean;
  isSuggestion: boolean; // True if below threshold, shown as suggestion only
  appliedPattern?: {
    id: number;
    incorrectPattern: string;
    correctPattern: string;
    confidence: number;
  };
}

interface ThresholdSettings {
  globalMinConfidence: number;
  suggestionThreshold: number;
  autoApplyEnabled: boolean;
}

interface CorrectionLog {
  fieldName: string;
  originalValue: string;
  correctedValue: string;
  patternId: number;
  confidence: number;
}

/**
 * Get threshold settings from database
 */
async function getThresholdSettings(): Promise<ThresholdSettings> {
  const db = await getDb();
  if (!db) {
    // Default settings if DB unavailable
    return {
      globalMinConfidence: 80,
      suggestionThreshold: 50,
      autoApplyEnabled: true,
    };
  }

  const settings = await db
    .select()
    .from(ocrCorrectionSettings)
    .where(
      sql`${ocrCorrectionSettings.settingKey} IN ('global_min_confidence', 'suggestion_threshold', 'auto_apply_enabled')`
    );

  const settingsMap = settings.reduce((acc, setting) => {
    if (setting.settingKey) acc[setting.settingKey] = setting.settingValue ?? '';
    return acc;
  }, {} as Record<string, string>);

  return {
    globalMinConfidence: parseInt(settingsMap.global_min_confidence || '80'),
    suggestionThreshold: parseInt(settingsMap.suggestion_threshold || '50'),
    autoApplyEnabled: settingsMap.auto_apply_enabled === 'true',
  };
}

/**
 * Apply corrections to a single field value
 */
export async function applyCorrection(
  fieldName: string,
  value: string
): Promise<CorrectionResult> {
  const db = await getDb();
  if (!db) {
    return {
      originalValue: value,
      correctedValue: value,
      wasCorrected: false,
      isSuggestion: false,
    };
  }

  // Get threshold settings
  const thresholds = await getThresholdSettings();

  // Get active patterns for this field
  const patterns = await db
    .select()
    .from(ocrCorrectionPatterns)
    .where(
      and(
        eq(ocrCorrectionPatterns.fieldName, fieldName),
        eq(ocrCorrectionPatterns.status, "active")
      )
    )
    .orderBy(ocrCorrectionPatterns.confidence);

  // Try to find a matching pattern
  for (const pattern of patterns) {
    let correctedValue: string | null = null;

    switch (pattern.patternType) {
      case "exact":
        if (value === pattern.incorrectPattern) {
          correctedValue = pattern.correctPattern;
        }
        break;

      case "regex":
        try {
          const regex = new RegExp(pattern.incorrectPattern, "gi");
          if (regex.test(value)) {
            correctedValue = value.replace(regex, pattern.correctPattern);
          }
        } catch (error) {
          log.error(`[AutoCorrection] Invalid regex pattern: ${pattern.incorrectPattern}`);
        }
        break;

      case "fuzzy":
        // Simple fuzzy matching using Levenshtein distance
        if (calculateSimilarity(value, pattern.incorrectPattern) > 0.8) {
          correctedValue = pattern.correctPattern;
        }
        break;
    }

    if (correctedValue && correctedValue !== value) {
      // Check if pattern confidence meets threshold
      const shouldAutoApply = 
        thresholds.autoApplyEnabled && 
        pattern.confidence >= thresholds.globalMinConfidence;

      const isSuggestion = 
        pattern.confidence >= thresholds.suggestionThreshold &&
        pattern.confidence < thresholds.globalMinConfidence;

      if (shouldAutoApply) {
        log.info(`[AutoCorrection] Auto-applied pattern ${pattern.id} to field ${fieldName}: "${value}" → "${correctedValue}" (confidence: ${pattern.confidence}%)`);
      } else if (isSuggestion) {
        log.info(`[AutoCorrection] Suggested pattern ${pattern.id} for field ${fieldName}: "${value}" → "${correctedValue}" (confidence: ${pattern.confidence}%)`);
      }

      return {
        originalValue: value,
        correctedValue: shouldAutoApply ? correctedValue : value,
        wasCorrected: shouldAutoApply,
        isSuggestion: isSuggestion,
        appliedPattern: {
          id: pattern.id,
          incorrectPattern: pattern.incorrectPattern,
          correctPattern: pattern.correctPattern,
          confidence: pattern.confidence,
        },
      };
    }
  }

  // No correction applied
  return {
    originalValue: value,
    correctedValue: value,
    wasCorrected: false,
    isSuggestion: false,
  };
}

/**
 * Apply corrections to multiple fields
 */
export async function applyCorrections(
  fields: Record<string, string>
): Promise<{
  correctedFields: Record<string, string>;
  corrections: CorrectionLog[];
}> {
  const correctedFields: Record<string, string> = {};
  const corrections: CorrectionLog[] = [];

  for (const [fieldName, value] of Object.entries(fields)) {
    if (!value) {
      correctedFields[fieldName] = value;
      continue;
    }

    const result = await applyCorrection(fieldName, value);
    correctedFields[fieldName] = result.correctedValue;

    if (result.wasCorrected && result.appliedPattern) {
      corrections.push({
        fieldName,
        originalValue: result.originalValue,
        correctedValue: result.correctedValue,
        patternId: result.appliedPattern.id,
        confidence: result.appliedPattern.confidence,
      });
    }
  }

  return { correctedFields, corrections };
}

/**
 * Record correction success/failure for learning
 */
export async function recordCorrectionFeedback(
  patternId: number,
  wasAccepted: boolean
): Promise<void> {
  const db = await getDb();
  if (!db) {
    return;
  }

  const field = wasAccepted ? "successCount" : "failureCount";
  
  await db
    .update(ocrCorrectionPatterns)
    .set({
      [field]: sql`${field} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(ocrCorrectionPatterns.id, patternId));

  // Recalculate confidence based on success rate
  const pattern = await db
    .select()
    .from(ocrCorrectionPatterns)
    .where(eq(ocrCorrectionPatterns.id, patternId))
    .limit(1)
    .then(rows => rows[0]);

  if (pattern) {
    const totalApplications = pattern.successCount + pattern.failureCount;
    const successRate = pattern.successCount / totalApplications;
    const newConfidence = Math.round(successRate * 100);

    await db
      .update(ocrCorrectionPatterns)
      .set({
        confidence: newConfidence,
        // Disable pattern if success rate drops below 50%
        status: successRate < 0.5 ? "disabled" : pattern.status,
      })
      .where(eq(ocrCorrectionPatterns.id, patternId));
  }
}

/**
 * Calculate string similarity using Levenshtein distance
 */
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) {
    return 1.0;
  }

  const distance = levenshteinDistance(longer.toLowerCase(), shorter.toLowerCase());
  return (longer.length - distance) / longer.length;
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

// Import sql for the recordCorrectionFeedback function
import { sql } from "drizzle-orm";
import { createChildLogger } from '../lib/logger';

const log = createChildLogger('autoCorrectionEngine');
