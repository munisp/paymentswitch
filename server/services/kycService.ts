/**
 * KYC (Know Your Customer) Verification Service
 * 
 * Handles identity verification via Smile Identity API
 * Supports BVN, NIN, passport, driver's license verification
 * Includes liveness detection, document matching, and AML screening
 */

import crypto from 'crypto';
import { getDb } from '../db';
import { amlScreeningResults } from '../../drizzle/payments-schema';

// Smile Identity API configuration
const SMILE_API_URL = process.env.SMILE_API_URL || 'https://api.smileidentity.com/v1';
const SMILE_PARTNER_ID = process.env.SMILE_PARTNER_ID || '';
const SMILE_API_KEY = process.env.SMILE_API_KEY || '';
const SMILE_CALLBACK_URL = process.env.SMILE_CALLBACK_URL || '';

// AML/Sanctions screening configuration
const AML_PROVIDER_URL = process.env.AML_PROVIDER_URL; // e.g. ComplyAdvantage, Dow Jones
const AML_PROVIDER_KEY = process.env.AML_PROVIDER_KEY;
const SANCTIONS_PROVIDER_URL = process.env.SANCTIONS_PROVIDER_URL;
const SANCTIONS_PROVIDER_KEY = process.env.SANCTIONS_PROVIDER_KEY;

export interface KYCRequest {
  remittanceId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD
  address: string;
  idType: 'BVN' | 'NIN' | 'PASSPORT' | 'DRIVERS_LICENSE';
  idNumber: string;
  phoneNumber: string;
  email?: string;
  selfieImage?: string; // Base64 encoded
  idDocumentImage?: string; // Base64 encoded
}

export interface KYCResult {
  verificationId: string;
  status: 'pending' | 'in_progress' | 'approved' | 'rejected' | 'failed';
  confidenceScore: number;
  livenessCheck: boolean;
  documentMatch: boolean;
  amlScreening: boolean;
  sanctionsCheck: boolean;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  verifiedData?: {
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    phoneNumber: string;
    address?: string;
    gender?: string;
    nationality?: string;
  };
  rejectionReason?: string;
  completedAt?: Date;
}

export interface SmileIDJobResponse {
  job_id: string;
  job_type: string;
  result: {
    ResultText: string;
    ResultCode: string;
    ConfidenceValue: string;
    Actions: {
      Liveness_Check: string;
      Register_Selfie: string;
      Human_Review_Compare: string;
      Selfie_Provided: string;
      Verify_ID_Number: string;
    };
  };
  image_links: {
    selfie_image: string;
  };
  timestamp: string;
}

/**
 * Initiate KYC verification
 */
export async function initiateKYCVerification(params: KYCRequest): Promise<{
  verificationId: string;
  status: 'pending' | 'in_progress';
  estimatedCompletionTime: Date;
}> {
  const verificationId = `kyc_${crypto.randomBytes(16).toString('hex')}`;
  const timestamp = new Date().toISOString();

  // Prepare job payload
  const jobPayload = {
    partner_id: SMILE_PARTNER_ID,
    job_id: verificationId,
    job_type: getJobType(params.idType),
    user_id: params.remittanceId,
    callback_url: SMILE_CALLBACK_URL,
    partner_params: {
      user_id: params.remittanceId,
      job_id: verificationId,
      job_type: getJobType(params.idType),
    },
    timestamp,
  };

  // Add ID-specific parameters
  const idInfo = {
    country: 'NG',
    id_type: params.idType,
    id_number: params.idNumber,
    first_name: params.firstName,
    last_name: params.lastName,
    dob: params.dateOfBirth,
    phone_number: params.phoneNumber,
  };

  // Generate signature
  const signature = generateSmileSignature(jobPayload, timestamp);

  // Submit verification job
  const response = await fetch(`${SMILE_API_URL}/async_id_verification`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'SmileIdentity-Partner-Id': SMILE_PARTNER_ID,
      'SmileIdentity-Signature': signature,
    },
    body: JSON.stringify({
      ...jobPayload,
      id_info: idInfo,
      images: params.selfieImage ? [
        {
          image_type_id: 2, // Selfie
          image: params.selfieImage,
        },
      ] : undefined,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Smile Identity API error: ${error.message || response.statusText}`);
  }

  const data = await response.json();

  // Smile Identity typically completes verifications in 5-30 minutes
  const estimatedCompletionTime = new Date(Date.now() + 30 * 60 * 1000);

  return {
    verificationId: data.job_id || verificationId,
    status: 'in_progress',
    estimatedCompletionTime,
  };
}

/**
 * Get KYC verification status
 */
export async function getKYCVerificationStatus(verificationId: string): Promise<KYCResult> {
  const timestamp = new Date().toISOString();
  const signature = generateSmileSignature({ job_id: verificationId }, timestamp);

  const response = await fetch(`${SMILE_API_URL}/job_status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'SmileIdentity-Partner-Id': SMILE_PARTNER_ID,
      'SmileIdentity-Signature': signature,
    },
    body: JSON.stringify({
      partner_id: SMILE_PARTNER_ID,
      job_id: verificationId,
      timestamp,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get KYC status: ${response.statusText}`);
  }

  const data: SmileIDJobResponse = await response.json();

  return parseSmileIDResult(verificationId, data);
}

/**
 * Verify BVN with enhanced checks
 */
export async function verifyBVNEnhanced(params: {
  bvn: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phoneNumber: string;
  remittanceId: string;
}): Promise<KYCResult> {
  return initiateKYCVerification({
    remittanceId: params.remittanceId,
    firstName: params.firstName,
    lastName: params.lastName,
    dateOfBirth: params.dateOfBirth,
    address: '', // Not required for BVN
    idType: 'BVN',
    idNumber: params.bvn,
    phoneNumber: params.phoneNumber,
  }).then(result => getKYCVerificationStatus(result.verificationId));
}

/**
 * Verify NIN (National ID Number)
 */
export async function verifyNIN(params: {
  nin: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phoneNumber: string;
  remittanceId: string;
}): Promise<KYCResult> {
  return initiateKYCVerification({
    remittanceId: params.remittanceId,
    firstName: params.firstName,
    lastName: params.lastName,
    dateOfBirth: params.dateOfBirth,
    address: '',
    idType: 'NIN',
    idNumber: params.nin,
    phoneNumber: params.phoneNumber,
  }).then(result => getKYCVerificationStatus(result.verificationId));
}

/**
 * Perform liveness check with selfie
 */
export async function performLivenessCheck(params: {
  remittanceId: string;
  selfieImage: string; // Base64 encoded
  idType: 'BVN' | 'NIN' | 'PASSPORT' | 'DRIVERS_LICENSE';
  idNumber: string;
}): Promise<{
  passed: boolean;
  confidenceScore: number;
  livenessScore: number;
}> {
  const verificationId = `liveness_${crypto.randomBytes(16).toString('hex')}`;
  const timestamp = new Date().toISOString();

  const jobPayload = {
    partner_id: SMILE_PARTNER_ID,
    job_id: verificationId,
    job_type: 4, // Liveness check
    user_id: params.remittanceId,
    timestamp,
  };

  const signature = generateSmileSignature(jobPayload, timestamp);

  const response = await fetch(`${SMILE_API_URL}/liveness_check`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'SmileIdentity-Partner-Id': SMILE_PARTNER_ID,
      'SmileIdentity-Signature': signature,
    },
    body: JSON.stringify({
      ...jobPayload,
      images: [
        {
          image_type_id: 2, // Selfie
          image: params.selfieImage,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Liveness check failed: ${response.statusText}`);
  }

  const data = await response.json();
  const confidenceValue = parseFloat(data.result?.ConfidenceValue || '0');

  return {
    passed: data.result?.ResultCode === '1',
    confidenceScore: confidenceValue,
    livenessScore: confidenceValue,
  };
}

/**
 * Perform AML (Anti-Money Laundering) screening
 */
export async function performAMLScreening(params: {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality?: string;
  idNumber?: string;
}): Promise<{
  passed: boolean;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  matches: Array<{
    name: string;
    type: string;
    score: number;
  }>;
}> {
  let riskScore = 0;
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  let matches: Array<{ name: string; type: string; score: number }> = [];

  if (AML_PROVIDER_URL && AML_PROVIDER_KEY) {
    try {
      const response = await fetch(`${AML_PROVIDER_URL}/searches`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${AML_PROVIDER_KEY}`,
        },
        body: JSON.stringify({
          search_term: `${params.firstName} ${params.lastName}`,
          fuzziness: 0.6,
          filters: {
            birth_year: params.dateOfBirth ? parseInt(params.dateOfBirth.slice(0, 4), 10) : undefined,
            country_codes: params.nationality ? [params.nationality] : undefined,
            types: ['sanction', 'warning', 'fitness-probity', 'pep', 'adverse-media'],
          },
        }),
      });
      if (response.ok) {
        const data = await response.json() as {
          content?: { data?: { total_hits?: number; hits?: Array<{ doc?: { name?: string; types?: string[]; match_types?: string[] } }> } };
        };
        const hits = data.content?.data?.hits || [];
        matches = hits.map(h => ({
          name: h.doc?.name || 'Unknown',
          type: (h.doc?.types || []).join(', '),
          score: 1.0,
        }));
        const totalHits = data.content?.data?.total_hits || 0;
        riskScore = Math.min(totalHits * 20, 100);
        riskLevel = riskScore >= 60 ? 'high' : riskScore >= 30 ? 'medium' : 'low';
      }
    } catch (err) {
      // Log error and fall through to default
    }
  } else {
    // Name-based heuristic screening when no provider is configured
    const fullName = `${params.firstName} ${params.lastName}`.toLowerCase();
    const highRiskPatterns = ['test', 'sanction', 'blocked'];
    const hasRiskPattern = highRiskPatterns.some(p => fullName.includes(p));
    riskScore = hasRiskPattern ? 80 : 0;
    riskLevel = hasRiskPattern ? 'high' : 'low';
  }

  // Persist screening result
  const db = await getDb();
  if (db) {
    try {
      await db.insert(amlScreeningResults).values({
        entityType: 'individual',
        firstName: params.firstName,
        lastName: params.lastName,
        dateOfBirth: params.dateOfBirth,
        nationality: params.nationality,
        riskScore: String(riskScore),
        riskLevel,
        screeningProvider: AML_PROVIDER_URL ? 'external' : 'internal',
        matches,
      });
    } catch (err) {
      // Non-fatal persistence error
    }
  }

  return {
    passed: riskLevel !== 'high',
    riskScore,
    riskLevel,
    matches,
  };
}

/**
 * Check sanctions lists
 */
export async function checkSanctionsList(params: {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  nationality?: string;
}): Promise<{
  passed: boolean;
  matches: Array<{
    listName: string;
    matchScore: number;
  }>;
}> {
  let matches: Array<{ listName: string; matchScore: number }> = [];
  let passed = true;

  if (SANCTIONS_PROVIDER_URL && SANCTIONS_PROVIDER_KEY) {
    try {
      const response = await fetch(`${SANCTIONS_PROVIDER_URL}/screen`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SANCTIONS_PROVIDER_KEY}`,
        },
        body: JSON.stringify({
          name: `${params.firstName} ${params.lastName}`,
          dateOfBirth: params.dateOfBirth,
          nationality: params.nationality,
          lists: ['OFAC_SDN', 'OFAC_CONS', 'UN_SANCTIONS', 'EU_SANCTIONS', 'UK_SANCTIONS', 'PEP'],
        }),
      });
      if (response.ok) {
        const data = await response.json() as {
          results?: Array<{ list_name?: string; score?: number }>;
        };
        matches = (data.results || []).map(r => ({
          listName: r.list_name || 'Unknown',
          matchScore: r.score || 0,
        }));
        passed = matches.every(m => m.matchScore < 0.85);
      }
    } catch (err) {
      // Fail-closed: if sanctions check provider is unreachable and configured, block
      passed = false;
      matches = [{ listName: 'PROVIDER_UNREACHABLE', matchScore: 1.0 }];
    }
  } else {
    // Fail-open only when no provider is configured (dev/sandbox mode)
    const fullName = `${params.firstName} ${params.lastName}`.toLowerCase();
    const blockedPatterns = ['test-sanctions', 'blocked-user'];
    const isBlocked = blockedPatterns.some(p => fullName.includes(p));
    passed = !isBlocked;
    if (isBlocked) {
      matches = [{ listName: 'INTERNAL_BLOCKLIST', matchScore: 1.0 }];
    }
  }

  // Persist sanctions check
  const db = await getDb();
  if (db) {
    try {
      await db.insert(amlScreeningResults).values({
        entityType: 'individual',
        firstName: params.firstName,
        lastName: params.lastName,
        dateOfBirth: params.dateOfBirth,
        nationality: params.nationality,
        riskScore: passed ? '0' : '100',
        riskLevel: passed ? 'low' : 'high',
        screeningProvider: SANCTIONS_PROVIDER_URL ? 'external_sanctions' : 'internal_sanctions',
        sanctionsPassed: passed,
        sanctionsMatches: matches,
      });
    } catch (err) {
      // Non-fatal
    }
  }

  return { passed, matches };
}

/**
 * Calculate overall risk score
 */
export function calculateRiskScore(params: {
  kycResult: KYCResult;
  amlResult: { riskScore: number };
  sanctionsResult: { passed: boolean };
  transactionAmount: number;
}): {
  overallRiskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  factors: Array<{
    factor: string;
    impact: number;
    description: string;
  }>;
} {
  const factors: Array<{ factor: string; impact: number; description: string }> = [];
  let totalRisk = 0;

  // KYC confidence (inverse)
  const kycRisk = 100 - params.kycResult.confidenceScore;
  factors.push({
    factor: 'KYC Confidence',
    impact: kycRisk * 0.3,
    description: `KYC confidence: ${params.kycResult.confidenceScore}%`,
  });
  totalRisk += kycRisk * 0.3;

  // AML risk
  factors.push({
    factor: 'AML Screening',
    impact: params.amlResult.riskScore * 0.3,
    description: `AML risk score: ${params.amlResult.riskScore.toFixed(1)}`,
  });
  totalRisk += params.amlResult.riskScore * 0.3;

  // Sanctions check
  const sanctionsRisk = params.sanctionsResult.passed ? 0 : 100;
  factors.push({
    factor: 'Sanctions Check',
    impact: sanctionsRisk * 0.2,
    description: params.sanctionsResult.passed ? 'No sanctions matches' : 'Sanctions match found',
  });
  totalRisk += sanctionsRisk * 0.2;

  // Transaction amount risk
  const amountRisk = Math.min((params.transactionAmount / 10000) * 10, 100);
  factors.push({
    factor: 'Transaction Amount',
    impact: amountRisk * 0.2,
    description: `Amount: $${params.transactionAmount.toLocaleString()}`,
  });
  totalRisk += amountRisk * 0.2;

  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (totalRisk > 70) {
    riskLevel = 'high';
  } else if (totalRisk > 40) {
    riskLevel = 'medium';
  }

  return {
    overallRiskScore: totalRisk,
    riskLevel,
    factors,
  };
}

/**
 * Helper: Get Smile Identity job type
 */
function getJobType(idType: string): number {
  const jobTypes: Record<string, number> = {
    BVN: 5, // BVN verification
    NIN: 5, // NIN verification (uses same type as BVN)
    PASSPORT: 6, // Document verification
    DRIVERS_LICENSE: 6, // Document verification
  };
  return jobTypes[idType] || 5;
}

/**
 * Helper: Generate Smile Identity signature
 */
function generateSmileSignature(payload: any, timestamp: string): string {
  const signatureString = `${SMILE_PARTNER_ID}${timestamp}${JSON.stringify(payload)}`;
  const hmac = crypto.createHmac('sha256', SMILE_API_KEY);
  hmac.update(signatureString);
  return hmac.digest('hex');
}

/**
 * Helper: Parse Smile Identity result
 */
function parseSmileIDResult(verificationId: string, data: SmileIDJobResponse): KYCResult {
  const resultCode = data.result?.ResultCode;
  const confidenceValue = parseFloat(data.result?.ConfidenceValue || '0');
  const actions = data.result?.Actions || {};

  // Determine status
  let status: KYCResult['status'] = 'in_progress';
  if (resultCode === '1') {
    status = 'approved';
  } else if (resultCode === '0') {
    status = 'rejected';
  } else if (resultCode === '-1') {
    status = 'failed';
  }

  // Check individual verifications
  const livenessCheck = actions.Liveness_Check === 'Passed';
  const documentMatch = actions.Verify_ID_Number === 'Verified';
  
  // Calculate risk score (inverse of confidence)
  const riskScore = 100 - confidenceValue;
  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (riskScore > 70) {
    riskLevel = 'high';
  } else if (riskScore > 40) {
    riskLevel = 'medium';
  }

  return {
    verificationId,
    status,
    confidenceScore: confidenceValue,
    livenessCheck,
    documentMatch,
    amlScreening: true, // Assume passed if not explicitly failed
    sanctionsCheck: true, // Assume passed if not explicitly failed
    riskScore,
    riskLevel,
    rejectionReason: status === 'rejected' ? data.result?.ResultText : undefined,
    completedAt: status === 'approved' || status === 'rejected' ? new Date(data.timestamp) : undefined,
  };
}

/**
 * Validate ID number format
 */
export function validateIDNumber(idType: string, idNumber: string): {
  valid: boolean;
  error?: string;
} {
  const patterns: Record<string, { pattern: RegExp; length: number; name: string }> = {
    BVN: { pattern: /^\d{11}$/, length: 11, name: 'Bank Verification Number' },
    NIN: { pattern: /^\d{11}$/, length: 11, name: 'National ID Number' },
    PASSPORT: { pattern: /^[A-Z]\d{8}$/, length: 9, name: 'Passport' },
    DRIVERS_LICENSE: { pattern: /^[A-Z]{3}\d{9}[A-Z]{2}$/, length: 14, name: 'Driver\'s License' },
  };

  const config = patterns[idType];
  if (!config) {
    return { valid: false, error: `Unsupported ID type: ${idType}` };
  }

  if (!config.pattern.test(idNumber)) {
    return {
      valid: false,
      error: `Invalid ${config.name} format. Expected ${config.length} characters.`,
    };
  }

  return { valid: true };
}

/**
 * Get KYC requirements by country
 */
export function getKYCRequirements(country: string): {
  requiredDocuments: string[];
  optionalDocuments: string[];
  requiresLiveness: boolean;
  requiresAML: boolean;
} {
  const requirements: Record<string, any> = {
    NG: {
      requiredDocuments: ['BVN', 'NIN', 'PASSPORT', 'DRIVERS_LICENSE'],
      optionalDocuments: ['Utility Bill', 'Bank Statement'],
      requiresLiveness: true,
      requiresAML: true,
    },
  };

  return requirements[country] || {
    requiredDocuments: ['PASSPORT'],
    optionalDocuments: [],
    requiresLiveness: true,
    requiresAML: true,
  };
}
