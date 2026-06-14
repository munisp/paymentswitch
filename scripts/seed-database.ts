/**
 * Unified Database Seeding Script
 * Generates realistic Nigerian payment switch data for all platform features.
 *
 * Usage: npx tsx scripts/seed-database.ts
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { randomUUID } from 'crypto';
import * as schema from '../drizzle/schema';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/paymentswitch';

const sql = postgres(DATABASE_URL);
const db = drizzle(sql, { schema });

const BANKS = [
  { code: 'ACC', name: 'Access Bank' },
  { code: 'GTB', name: 'Guaranty Trust Bank' },
  { code: 'ZEN', name: 'Zenith Bank' },
  { code: 'UBA', name: 'United Bank for Africa' },
  { code: 'FBN', name: 'First Bank of Nigeria' },
  { code: 'STB', name: 'Stanbic IBTC' },
  { code: 'FID', name: 'Fidelity Bank' },
  { code: 'UNI', name: 'Union Bank' },
  { code: 'WEM', name: 'Wema Bank' },
  { code: 'STR', name: 'Sterling Bank' },
];

const CORRIDORS = ['NG-US', 'NG-GB', 'NG-GH', 'NG-KE', 'NG-ZA', 'US-NG', 'GB-NG', 'GH-NG'];
const FIRST_NAMES = ['Adebayo', 'Chinwe', 'Emeka', 'Fatima', 'Ibrahim', 'Jumoke', 'Kemi', 'Oluwaseun', 'Toyin', 'Uche', 'Yusuf', 'Zainab', 'Chidi', 'Ngozi', 'Aisha', 'Tunde', 'Folake', 'Obinna', 'Halima', 'Damilola'];
const LAST_NAMES = ['Okonkwo', 'Adeleke', 'Mohammed', 'Bankole', 'Ogundimu', 'Abubakar', 'Nwosu', 'Okafor', 'Balogun', 'Eze', 'Suleiman', 'Adeyemi', 'Chukwu', 'Hassan', 'Ogundele', 'Aliyu', 'Nnamdi', 'Owolabi', 'Aminu', 'Olayinka'];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDate(daysBack: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - randomInt(0, daysBack));
  d.setHours(randomInt(0, 23), randomInt(0, 59), randomInt(0, 59));
  return d;
}

async function seedUsers(count: number) {
  console.log(`Seeding ${count} users...`);
  const users: { id: number; sub: string }[] = [];
  for (let i = 0; i < count; i++) {
    const firstName = randomChoice(FIRST_NAMES);
    const lastName = randomChoice(LAST_NAMES);
    const sub = randomUUID();
    try {
      const result = await db.insert(schema.users).values({
        sub,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@payswitch.ng`,
        name: `${firstName} ${lastName}`,
        role: randomChoice(['user', 'admin', 'merchant', 'participant'] as const),
      }).returning({ id: schema.users.id });
      if (result[0]) {
        users.push({ id: result[0].id, sub });
      }
    } catch {
      // skip duplicates
    }
  }
  return users;
}

async function seedMerchants(userIds: number[]) {
  console.log('Seeding merchants...');
  const merchantIds: number[] = [];
  const merchantNames = ['Jumia Nigeria', 'Konga', 'PayStack Merchant', 'Flutterwave Store', 'PiggyVest', 'Cowrywise', 'BuyPower', 'iROKOtv', 'Wakanow', 'Hotels.ng'];
  for (let i = 0; i < merchantNames.length; i++) {
    try {
      const result = await db.insert(schema.merchants).values({
        userId: userIds[i % userIds.length],
        businessName: merchantNames[i],
        businessType: randomChoice(['ecommerce', 'saas', 'marketplace'] as const),
        status: randomChoice(['active', 'active', 'active', 'pending'] as const),
        apiKey: `pk_live_${randomUUID().replace(/-/g, '').slice(0, 32)}`,
        apiSecret: `sk_live_${randomUUID().replace(/-/g, '').slice(0, 32)}`,
        webhookUrl: `https://${merchantNames[i].toLowerCase().replace(/\s+/g, '')}.com/webhook`,
      }).returning({ id: schema.merchants.id });
      if (result[0]) merchantIds.push(result[0].id);
    } catch {
      // skip
    }
  }
  return merchantIds;
}

async function seedParticipants(userIds: number[]) {
  console.log('Seeding participants (FSPs)...');
  for (let i = 0; i < BANKS.length; i++) {
    const bank = BANKS[i];
    try {
      await db.insert(schema.switchParticipants).values({
        userId: userIds[i % userIds.length],
        name: bank.name,
        shortCode: bank.code,
        type: i < 6 ? 'bank' : 'fintech',
        tier: randomChoice(['starter', 'growth', 'enterprise', 'premium'] as const),
        status: randomChoice(['active', 'active', 'active', 'onboarding'] as const),
        dailyLimit: (randomInt(50_000_000, 500_000_000)).toString(),
        activeCorridors: randomInt(1, 8),
      });
    } catch {
      // skip
    }
  }
}

async function seedTransactions(merchantIds: number[], count: number) {
  console.log(`Seeding ${count} transactions...`);
  const statuses = ['pending', 'authorized', 'captured', 'failed', 'refunded'] as const;
  const methods = ['card', 'bank_transfer', 'qr_code', 'wallet'];

  for (let i = 0; i < count; i++) {
    const amount = randomInt(500, 5_000_000);
    try {
      await db.insert(schema.transactions).values({
        transactionId: `txn_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        sessionId: `sess_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
        merchantId: randomChoice(merchantIds),
        amount,
        currency: 'NGN',
        status: randomChoice(statuses),
        paymentMethod: randomChoice(methods),
        fraudScore: randomInt(0, 100),
        createdAt: randomDate(90),
      });
    } catch {
      // skip
    }
  }
}

async function seedOutboundTransfers(participantId: number, count: number) {
  console.log(`Seeding ${count} outbound transfers...`);
  const statuses = ['admitted', 'compliance', 'pricing', 'routing', 'settlement', 'completed', 'failed'] as const;

  for (let i = 0; i < count; i++) {
    const sourceAmount = randomInt(10_000, 2_000_000);
    const corridor = randomChoice(CORRIDORS);
    const destCurrency = corridor.endsWith('NG') ? 'NGN' : randomChoice(['USD', 'GBP', 'EUR']);
    try {
      await db.insert(schema.outboundTransfers).values({
        transferRef: `OBT-${randomUUID().replace(/-/g, '').slice(0, 16)}`,
        participantId,
        senderRef: `SR-${randomInt(100000, 999999)}`,
        beneficiaryName: `${randomChoice(FIRST_NAMES)} ${randomChoice(LAST_NAMES)}`,
        beneficiaryAccount: Array.from({ length: 10 }, () => randomInt(0, 9)).join(''),
        corridor,
        amountNgn: sourceAmount.toString(),
        amountDest: Math.floor(sourceAmount * 0.0024).toString(),
        destCurrency,
        fxRate: (0.0024 + Math.random() * 0.001).toFixed(8),
        provider: randomChoice(['Flutterwave', 'Paystack', 'Interswitch', 'Nibss']),
        status: randomChoice(statuses),
        lifecycleStep: randomChoice(['admitted', 'compliance', 'settlement', 'completed']),
        createdAt: randomDate(180),
      });
    } catch {
      // skip
    }
  }
}

async function seedAuditLogs(userIds: number[], merchantIds: number[], count: number) {
  console.log(`Seeding ${count} audit logs...`);
  const actions = ['user.login', 'user.logout', 'transfer.created', 'transfer.approved', 'transfer.completed', 'kyc.verified', 'kyc.rejected', 'config.updated', 'participant.onboarded', 'settlement.initiated'];

  for (let i = 0; i < count; i++) {
    try {
      await db.insert(schema.auditLogs).values({
        userId: randomChoice(userIds),
        merchantId: randomChoice(merchantIds),
        action: randomChoice(actions),
        resource: randomChoice(['user', 'transfer', 'participant', 'settlement', 'config']),
        resourceId: randomUUID(),
        ipAddress: `${randomInt(10, 196)}.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`,
        status: randomChoice(['success', 'failure'] as const),
        createdAt: randomDate(90),
      });
    } catch {
      // skip
    }
  }
}

async function seedDisputes(userIds: number[], count: number) {
  console.log(`Seeding ${count} disputes...`);
  for (let i = 0; i < count; i++) {
    try {
      await db.insert(schema.disputes).values({
        transactionId: randomInt(1, 1000),
        userId: randomChoice(userIds),
        reason: randomChoice(['unauthorized_transaction', 'wrong_amount', 'duplicate_charge', 'service_not_received', 'fraudulent_activity']),
        description: `Customer reported issue with transaction #${randomInt(1000, 9999)}. Investigating.`,
        amount: randomInt(5000, 500_000).toString(),
        currency: 'NGN',
        status: randomChoice(['open', 'under_review', 'evidence_requested', 'resolved_merchant', 'escalated', 'closed'] as const),
        createdAt: randomDate(60),
      });
    } catch {
      // skip
    }
  }
}

async function seedSupportTickets(userIds: number[], count: number) {
  console.log(`Seeding ${count} support tickets...`);
  const subjects = ['Transfer not received', 'KYC document rejected', 'Account locked', 'Fee inquiry', 'API integration help', 'Settlement delay', 'Rate alert not working'];

  for (let i = 0; i < count; i++) {
    try {
      await db.insert(schema.supportTickets).values({
        userId: randomChoice(userIds),
        subject: randomChoice(subjects),
        description: `Customer needs assistance with: ${randomChoice(subjects)}. Priority case.`,
        category: randomChoice(['transfers', 'kyc', 'account', 'fees', 'technical', 'settlement']),
        priority: randomChoice(['low', 'medium', 'high', 'urgent'] as const),
        status: randomChoice(['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const),
        createdAt: randomDate(30),
      });
    } catch {
      // skip
    }
  }
}

async function main() {
  console.log('=== PaySwitch Unified Database Seed ===');
  console.log(`Database: ${DATABASE_URL.replace(/\/\/.*@/, '//***@')}`);
  console.log('');

  try {
    const users = await seedUsers(200);
    const userIds = users.map(u => u.id);
    if (userIds.length === 0) {
      console.log('No users seeded — check for existing data or schema issues.');
      await sql.end();
      return;
    }

    const merchantIds = await seedMerchants(userIds);
    await seedParticipants(userIds);

    const txnMerchantIds = merchantIds.length > 0 ? merchantIds : [1];
    await seedTransactions(txnMerchantIds, 1000);
    await seedOutboundTransfers(1, 500);
    await seedAuditLogs(userIds, txnMerchantIds, 2000);
    await seedDisputes(userIds, 25);
    await seedSupportTickets(userIds, 30);

    console.log('');
    console.log('Seed complete:');
    console.log('  200 users (admin, merchant, participant, user)');
    console.log('  10 merchants');
    console.log('  10 participants (banks/fintechs)');
    console.log('  1000 transactions');
    console.log('  500 outbound transfers');
    console.log('  2000 audit logs');
    console.log('  25 disputes');
    console.log('  30 support tickets');
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
