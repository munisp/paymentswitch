import { createChildLogger } from '../lib/logger';

const log = createChildLogger('agentCash');
/**
 * Agent Cash Service
 * 
 * Integrates with agent networks (Paga, OPay, Kudi) for cash pickup
 * Enables recipients to collect cash from nearby agents
 */

export interface AgentLocation {
  agentId: string;
  agentName: string;
  address: string;
  city: string;
  state: string;
  latitude: number;
  longitude: number;
  distance: number; // in kilometers
  operatingHours: string;
  services: string[];
}

export interface CollectionCode {
  code: string;
  remittanceId: string;
  amount: number;
  currency: string;
  recipientPhone: string;
  expiresAt: Date;
  qrCodeUrl: string;
  status: 'active' | 'collected' | 'expired' | 'cancelled';
}

/**
 * Find nearby agents based on location
 */
export async function findNearbyAgents(params: {
  latitude: number;
  longitude: number;
  radius?: number; // in kilometers, default 5km
  provider?: 'paga' | 'opay' | 'kudi' | 'all';
  limit?: number;
}): Promise<AgentLocation[]> {
  const radius = params.radius || 5;
  const limit = params.limit || 20;

  // Agent network data — in production, this queries the Paga/OPay/Kudi partner APIs
  // with geospatial filtering. Here we use seeded data covering major Nigerian cities.
  log.info(params, '[Agent Cash] Finding nearby agents');

  const allAgents: AgentLocation[] = [
    { agentId: 'paga_001', agentName: 'Paga Agent - Ikeja', address: '45 Allen Avenue, Ikeja', city: 'Lagos', state: 'Lagos', latitude: 6.5944, longitude: 3.3417, distance: 0, operatingHours: '8:00 AM - 8:00 PM', services: ['cash_pickup', 'bill_payment', 'airtime'] },
    { agentId: 'paga_002', agentName: 'Paga Agent - Surulere', address: '22 Adeniran Ogunsanya St', city: 'Lagos', state: 'Lagos', latitude: 6.4969, longitude: 3.3560, distance: 0, operatingHours: '8:00 AM - 8:00 PM', services: ['cash_pickup', 'bill_payment'] },
    { agentId: 'opay_001', agentName: 'OPay Agent - Victoria Island', address: '12 Akin Adesola Street, VI', city: 'Lagos', state: 'Lagos', latitude: 6.4281, longitude: 3.4219, distance: 0, operatingHours: '7:00 AM - 10:00 PM', services: ['cash_pickup', 'mobile_money', 'transfers'] },
    { agentId: 'opay_002', agentName: 'OPay Agent - Wuse 2', address: '34 Aminu Kano Crescent, Wuse 2', city: 'Abuja', state: 'FCT', latitude: 9.0765, longitude: 7.4898, distance: 0, operatingHours: '7:00 AM - 9:00 PM', services: ['cash_pickup', 'mobile_money'] },
    { agentId: 'kudi_001', agentName: 'Kudi Agent - Lekki', address: '78 Admiralty Way, Lekki Phase 1', city: 'Lagos', state: 'Lagos', latitude: 6.4474, longitude: 3.4708, distance: 0, operatingHours: '9:00 AM - 7:00 PM', services: ['cash_pickup'] },
    { agentId: 'kudi_002', agentName: 'Kudi Agent - Garki', address: '15 Gana Street, Garki Area 11', city: 'Abuja', state: 'FCT', latitude: 9.0579, longitude: 7.4951, distance: 0, operatingHours: '9:00 AM - 6:00 PM', services: ['cash_pickup', 'bill_payment'] },
    { agentId: 'paga_003', agentName: 'Paga Agent - Ring Road', address: '45 Ring Road, Challenge', city: 'Ibadan', state: 'Oyo', latitude: 7.3776, longitude: 3.9470, distance: 0, operatingHours: '8:00 AM - 7:00 PM', services: ['cash_pickup', 'airtime'] },
    { agentId: 'opay_003', agentName: 'OPay Agent - Sabon Gari', address: '12 Kano Road, Sabon Gari', city: 'Kano', state: 'Kano', latitude: 12.0022, longitude: 8.5920, distance: 0, operatingHours: '8:00 AM - 8:00 PM', services: ['cash_pickup', 'mobile_money', 'transfers'] },
    { agentId: 'paga_004', agentName: 'Paga Agent - GRA', address: '8 Okigwe Road, GRA', city: 'Port Harcourt', state: 'Rivers', latitude: 4.8156, longitude: 7.0498, distance: 0, operatingHours: '8:00 AM - 7:00 PM', services: ['cash_pickup', 'bill_payment'] },
    { agentId: 'opay_004', agentName: 'OPay Agent - New Haven', address: '23 Zik Avenue, New Haven', city: 'Enugu', state: 'Enugu', latitude: 6.4584, longitude: 7.5464, distance: 0, operatingHours: '8:00 AM - 8:00 PM', services: ['cash_pickup', 'mobile_money'] },
  ];

  // Calculate Haversine distance from user's coordinates
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  for (const agent of allAgents) {
    const dLat = toRad(agent.latitude - params.latitude);
    const dLon = toRad(agent.longitude - params.longitude);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(params.latitude)) * Math.cos(toRad(agent.latitude)) * Math.sin(dLon / 2) ** 2;
    agent.distance = Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
  }

  // Filter by provider if specified, then by radius
  let agents = allAgents.filter(a => a.distance <= radius);
  if (params.provider && params.provider !== 'all') {
    agents = agents.filter(a => a.agentId.startsWith(params.provider!));
  }

  // Sort by distance and limit results
  return agents
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

/**
 * Generate collection code for cash pickup
 */
export async function generateCollectionCode(params: {
  remittanceId: string;
  amount: number;
  currency: string;
  recipientPhone: string;
  provider: 'paga' | 'opay' | 'kudi';
  expiryHours?: number; // default 72 hours
}): Promise<CollectionCode> {
  const expiryHours = params.expiryHours || 72;
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

  // Generate 6-digit collection code
  const { randomInt } = require('crypto');
  const code = String(randomInt(100000, 999999));

  // Generate QR code (in production, use QR code library)
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${code}`;

  const collectionCode: CollectionCode = {
    code,
    remittanceId: params.remittanceId,
    amount: params.amount,
    currency: params.currency,
    recipientPhone: params.recipientPhone,
    expiresAt,
    qrCodeUrl,
    status: 'active',
  };

  // In production, register code with agent provider API
  switch (params.provider) {
    case 'paga':
      await registerPagaCollectionCode(collectionCode);
      break;
    case 'opay':
      await registerOPayCollectionCode(collectionCode);
      break;
    case 'kudi':
      await registerKudiCollectionCode(collectionCode);
      break;
  }

  // Store in database
  // await db.createCollectionCode(collectionCode);

  return collectionCode;
}

/**
 * Check collection code status
 */
export async function getCollectionCodeStatus(code: string): Promise<{
  code: string;
  status: 'active' | 'collected' | 'expired' | 'cancelled';
  collectedAt?: Date;
  agentId?: string;
  agentName?: string;
}> {
  // In production, fetch from database and check with provider
  // const collectionCode = await db.getCollectionCode(code);

  return {
    code,
    status: 'active',
  };
}

/**
 * Cancel collection code
 */
export async function cancelCollectionCode(code: string): Promise<boolean> {
  // In production, update database and notify provider
  // await db.updateCollectionCode(code, { status: 'cancelled' });

  return true;
}

/**
 * Get agent details
 */
export async function getAgentDetails(agentId: string): Promise<AgentLocation | null> {
  // In production, fetch from provider API
  const agents = await findNearbyAgents({
    latitude: 6.5244,
    longitude: 3.3792,
  });

  return agents.find(a => a.agentId === agentId) || null;
}

/**
 * Calculate agent cash pickup fee
 */
export function calculateAgentFee(amount: number, provider: 'paga' | 'opay' | 'kudi'): number {
  // Fee structure varies by provider
  const feeStructure: Record<string, { percentage: number; min: number; max: number }> = {
    paga: { percentage: 0.5, min: 50, max: 500 },
    opay: { percentage: 0.3, min: 30, max: 300 },
    kudi: { percentage: 0.4, min: 40, max: 400 },
  };

  const config = feeStructure[provider];
  const calculatedFee = amount * (config.percentage / 100);

  return Math.max(config.min, Math.min(calculatedFee, config.max));
}

/**
 * Paga Integration
 */
async function registerPagaCollectionCode(collectionCode: CollectionCode): Promise<void> {
  // In production, call Paga API
  log.info({ code: collectionCode.code }, '[Paga] Registered collection code');

  // Example Paga API call:
  // const response = await fetch('https://api.paga.com/v1/collection-codes', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'Authorization': `Bearer ${process.env.PAGA_API_KEY}`,
  //   },
  //   body: JSON.stringify({
  //     code: collectionCode.code,
  //     amount: collectionCode.amount,
  //     recipientPhone: collectionCode.recipientPhone,
  //     expiresAt: collectionCode.expiresAt,
  //   }),
  // });
}

/**
 * OPay Integration
 */
async function registerOPayCollectionCode(collectionCode: CollectionCode): Promise<void> {
  // In production, call OPay API
  log.info({ code: collectionCode.code }, '[OPay] Registered collection code');

  // Example OPay API call:
  // const response = await fetch('https://api.opay.com/v1/cashout/create', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'MerchantId': process.env.OPAY_MERCHANT_ID,
  //     'Authorization': `Bearer ${process.env.OPAY_API_KEY}`,
  //   },
  //   body: JSON.stringify({
  //     reference: collectionCode.remittanceId,
  //     code: collectionCode.code,
  //     amount: collectionCode.amount,
  //     phoneNumber: collectionCode.recipientPhone,
  //     expiryTime: collectionCode.expiresAt.toISOString(),
  //   }),
  // });
}

/**
 * Kudi Integration
 */
async function registerKudiCollectionCode(collectionCode: CollectionCode): Promise<void> {
  // In production, call Kudi API
  log.info({ code: collectionCode.code }, '[Kudi] Registered collection code');

  // Example Kudi API call:
  // const response = await fetch('https://api.kudi.com/v1/withdrawals', {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //     'X-API-Key': process.env.KUDI_API_KEY,
  //   },
  //   body: JSON.stringify({
  //     withdrawalCode: collectionCode.code,
  //     amount: collectionCode.amount,
  //     currency: collectionCode.currency,
  //     recipientPhone: collectionCode.recipientPhone,
  //     expiresAt: collectionCode.expiresAt,
  //   }),
  // });
}

/**
 * Send collection code via SMS
 */
export async function sendCollectionCodeSMS(params: {
  recipientPhone: string;
  code: string;
  amount: number;
  agentName: string;
  expiresAt: Date;
}): Promise<boolean> {
  const message = `Your cash pickup code is: ${params.code}. Collect ₦${params.amount.toLocaleString()} from any ${params.agentName} agent. Code expires on ${params.expiresAt.toLocaleDateString()}. Keep this code secure.`;

  // In production, send via Twilio, Africa's Talking, etc.
  log.info(`[SMS] Sending to ${params.recipientPhone}: ${message}`);

  return true;
}

/**
 * Validate collection code format
 */
export function validateCollectionCode(code: string): boolean {
  // 6-digit numeric code
  return /^\d{6}$/.test(code);
}

/**
 * Get supported agent providers
 */
export function getSupportedProviders(): Array<{
  id: string;
  name: string;
  description: string;
  feePercentage: number;
  minFee: number;
  maxFee: number;
  coverage: string[];
}> {
  return [
    {
      id: 'paga',
      name: 'Paga',
      description: 'Largest agent network in Nigeria with 25,000+ agents',
      feePercentage: 0.5,
      minFee: 50,
      maxFee: 500,
      coverage: ['Lagos', 'Abuja', 'Port Harcourt', 'Kano', 'Ibadan'],
    },
    {
      id: 'opay',
      name: 'OPay',
      description: 'Fast-growing mobile money platform with 10,000+ agents',
      feePercentage: 0.3,
      minFee: 30,
      maxFee: 300,
      coverage: ['Lagos', 'Abuja', 'Ogun', 'Rivers', 'Oyo'],
    },
    {
      id: 'kudi',
      name: 'Kudi',
      description: 'Digital banking platform with 5,000+ cash points',
      feePercentage: 0.4,
      minFee: 40,
      maxFee: 400,
      coverage: ['Lagos', 'Abuja', 'Enugu', 'Kaduna'],
    },
  ];
}
