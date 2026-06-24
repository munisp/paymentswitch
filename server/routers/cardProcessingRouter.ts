import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../_core/trpc';
import { getDb } from '../db';
import { issuedCards, cardTransactions, chargebacks } from '../../drizzle/payments-schema';
import { eq, and, desc } from 'drizzle-orm';

// --- Types & Seed Data ---

type IssuedCard = {
  id: string;
  tokenizedPAN: string;
  last4: string;
  scheme: string;
  type: string;
  issuerBankCode: string;
  issuerBankName: string;
  holderName: string;
  expiryMonth: number;
  expiryYear: number;
  status: string;
  dailyLimit: number;
  monthlyLimit: number;
  issuedAt: Date;
  is3DSEnrolled: boolean;
};

type CardTransaction = {
  id: string;
  authCode: string;
  rrn: string;
  type: string;
  cardLast4: string;
  scheme: string;
  merchantName: string;
  merchantCategory: string;
  terminalId: string;
  channel: string;
  amount: number;
  feeAmount: number;
  status: string;
  declineReason: string;
  is3DSVerified: boolean;
  riskScore: number;
  processedAt: Date;
};

type Chargeback = {
  id: string;
  transactionId: string;
  originalAmount: number;
  disputeAmount: number;
  reasonCode: string;
  reasonDesc: string;
  cardholderName: string;
  merchantName: string;
  status: string;
  filedAt: Date;
  dueDate: Date;
  resolution: string;
};

type MerchantTerminal = {
  id: string;
  terminalId: string;
  merchantId: string;
  merchantName: string;
  mcc: string;
  mccDescription: string;
  location: string;
  type: string;
  acquirerBank: string;
  status: string;
  dailyVolume: number;
};

const seedCards: IssuedCard[] = [
  { id: 'CRD-001', tokenizedPAN: 'tok_a1b2c3d4e5f6', last4: '4532', scheme: 'VISA', type: 'DEBIT', issuerBankCode: 'ACCESS', issuerBankName: 'Access Bank', holderName: 'Adebayo Ogunlade', expiryMonth: 12, expiryYear: 2028, status: 'active', dailyLimit: 5_000_000, monthlyLimit: 50_000_000, issuedAt: new Date('2025-06-15'), is3DSEnrolled: true },
  { id: 'CRD-002', tokenizedPAN: 'tok_f6e5d4c3b2a1', last4: '8891', scheme: 'MASTERCARD', type: 'CREDIT', issuerBankCode: 'GTB', issuerBankName: 'GTBank', holderName: 'Chioma Okafor', expiryMonth: 8, expiryYear: 2027, status: 'active', dailyLimit: 10_000_000, monthlyLimit: 100_000_000, issuedAt: new Date('2025-03-20'), is3DSEnrolled: true },
  { id: 'CRD-003', tokenizedPAN: 'tok_1a2b3c4d5e6f', last4: '2245', scheme: 'VERVE', type: 'DEBIT', issuerBankCode: 'ZENITH', issuerBankName: 'Zenith Bank', holderName: 'Emeka Nwosu', expiryMonth: 3, expiryYear: 2029, status: 'active', dailyLimit: 2_000_000, monthlyLimit: 20_000_000, issuedAt: new Date('2026-01-10'), is3DSEnrolled: true },
  { id: 'CRD-004', tokenizedPAN: 'tok_9x8y7z6w5v4u', last4: '6678', scheme: 'VISA', type: 'VIRTUAL', issuerBankCode: 'UBA', issuerBankName: 'UBA', holderName: 'Fatima Bello', expiryMonth: 6, expiryYear: 2027, status: 'active', dailyLimit: 1_000_000, monthlyLimit: 5_000_000, issuedAt: new Date('2026-02-28'), is3DSEnrolled: true },
  { id: 'CRD-005', tokenizedPAN: 'tok_m3n4o5p6q7r8', last4: '1123', scheme: 'MASTERCARD', type: 'PREPAID', issuerBankCode: 'FIRSTBANK', issuerBankName: 'First Bank', holderName: 'Grace Adeyemi', expiryMonth: 9, expiryYear: 2028, status: 'blocked', dailyLimit: 500_000, monthlyLimit: 3_000_000, issuedAt: new Date('2025-11-05'), is3DSEnrolled: false },
];

const seedTxns: CardTransaction[] = [
  { id: 'TXN-001', authCode: 'A1B2C3', rrn: '260501080001', type: 'PURCHASE', cardLast4: '4532', scheme: 'VISA', merchantName: 'ShopRite Ikeja', merchantCategory: 'Supermarket', terminalId: 'POS-SRI-001', channel: 'POS', amount: 45600, feeAmount: 228, status: 'approved', declineReason: '', is3DSVerified: false, riskScore: 12, processedAt: new Date('2026-05-01T09:30:00Z') },
  { id: 'TXN-002', authCode: 'D4E5F6', rrn: '260501100002', type: 'PURCHASE', cardLast4: '8891', scheme: 'MASTERCARD', merchantName: 'Jumia Online', merchantCategory: 'E-Commerce', terminalId: 'WEB-JUM-001', channel: 'WEB', amount: 125000, feeAmount: 1875, status: 'approved', declineReason: '', is3DSVerified: true, riskScore: 18, processedAt: new Date('2026-05-01T10:15:00Z') },
  { id: 'TXN-003', authCode: 'G7H8I9', rrn: '260501120003', type: 'WITHDRAWAL', cardLast4: '2245', scheme: 'VERVE', merchantName: 'Zenith Bank ATM Lagos', merchantCategory: 'ATM', terminalId: 'ATM-ZEN-042', channel: 'ATM', amount: 200000, feeAmount: 1000, status: 'approved', declineReason: '', is3DSVerified: false, riskScore: 8, processedAt: new Date('2026-05-01T12:00:00Z') },
  { id: 'TXN-004', authCode: '', rrn: '260501140004', type: 'PURCHASE', cardLast4: '6678', scheme: 'VISA', merchantName: 'Alibaba.com', merchantCategory: 'E-Commerce', terminalId: 'WEB-ALI-001', channel: 'WEB', amount: 850000, feeAmount: 12750, status: 'declined', declineReason: 'insufficient_funds', is3DSVerified: true, riskScore: 45, processedAt: new Date('2026-05-01T14:30:00Z') },
  { id: 'TXN-005', authCode: 'J1K2L3', rrn: '260501160005', type: 'PURCHASE', cardLast4: '4532', scheme: 'VISA', merchantName: 'Konga Electronics', merchantCategory: 'Electronics', terminalId: 'WEB-KON-001', channel: 'WEB', amount: 340000, feeAmount: 5100, status: 'approved', declineReason: '', is3DSVerified: true, riskScore: 22, processedAt: new Date('2026-05-01T16:00:00Z') },
  { id: 'TXN-006', authCode: 'M4N5O6', rrn: '260501170006', type: 'PRE_AUTH', cardLast4: '8891', scheme: 'MASTERCARD', merchantName: 'Radisson Blu Lagos', merchantCategory: 'Hotel', terminalId: 'POS-RAD-001', channel: 'POS', amount: 1_200_000, feeAmount: 6000, status: 'approved', declineReason: '', is3DSVerified: false, riskScore: 15, processedAt: new Date('2026-05-01T17:30:00Z') },
  { id: 'TXN-007', authCode: '', rrn: '260501180007', type: 'PURCHASE', cardLast4: '1123', scheme: 'MASTERCARD', merchantName: 'Unknown Merchant', merchantCategory: 'General', terminalId: 'WEB-UNK-001', channel: 'WEB', amount: 2_500_000, feeAmount: 0, status: 'declined', declineReason: 'card_blocked', is3DSVerified: false, riskScore: 92, processedAt: new Date('2026-05-01T18:00:00Z') },
];

const seedChargebacks: Chargeback[] = [
  { id: 'CB-001', transactionId: 'TXN-002', originalAmount: 125000, disputeAmount: 125000, reasonCode: '4837', reasonDesc: 'No cardholder authorization', cardholderName: 'Chioma Okafor', merchantName: 'Jumia Online', status: 'merchant_response', filedAt: new Date('2026-05-01'), dueDate: new Date('2026-05-31'), resolution: '' },
  { id: 'CB-002', transactionId: 'TXN-005', originalAmount: 340000, disputeAmount: 340000, reasonCode: '4853', reasonDesc: 'Goods not received', cardholderName: 'Adebayo Ogunlade', merchantName: 'Konga Electronics', status: 'initiated', filedAt: new Date('2026-05-02'), dueDate: new Date('2026-06-01'), resolution: '' },
];

const seedTerminals: MerchantTerminal[] = [
  { id: 'TERM-001', terminalId: 'POS-SRI-001', merchantId: 'MERCH-001', merchantName: 'ShopRite Ikeja', mcc: '5411', mccDescription: 'Grocery Stores/Supermarkets', location: 'Ikeja City Mall, Lagos', type: 'POS', acquirerBank: 'Access Bank', status: 'active', dailyVolume: 8_500_000 },
  { id: 'TERM-002', terminalId: 'WEB-JUM-001', merchantId: 'MERCH-002', merchantName: 'Jumia Nigeria', mcc: '5999', mccDescription: 'E-Commerce', location: 'Online', type: 'WEB', acquirerBank: 'GTBank', status: 'active', dailyVolume: 45_000_000 },
  { id: 'TERM-003', terminalId: 'POS-RAD-001', merchantId: 'MERCH-003', merchantName: 'Radisson Blu Lagos', mcc: '7011', mccDescription: 'Hotels/Lodging', location: 'VI, Lagos', type: 'POS', acquirerBank: 'Zenith Bank', status: 'active', dailyVolume: 12_000_000 },
  { id: 'TERM-004', terminalId: 'MPOS-FLW-001', merchantId: 'MERCH-004', merchantName: 'Local Market Vendor', mcc: '5999', mccDescription: 'Misc Retail', location: 'Balogun Market, Lagos', type: 'mPOS', acquirerBank: 'First Bank', status: 'active', dailyVolume: 450_000 },
  { id: 'TERM-005', terminalId: 'WEB-KON-001', merchantId: 'MERCH-005', merchantName: 'Konga Online', mcc: '5732', mccDescription: 'Electronics Stores', location: 'Online', type: 'WEB', acquirerBank: 'UBA', status: 'active', dailyVolume: 28_000_000 },
];

function getScope(user: { role: string }) {
  return { isAdmin: user.role === 'admin' || user.role === 'cbn' };
}

export const cardProcessingRouter = router({
  listCards: protectedProcedure
    .input(z.object({ scheme: z.string().optional(), type: z.string().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (db) {
        const conditions = [];
        if (input?.scheme) conditions.push(eq(issuedCards.scheme, input.scheme));
        if (input?.type) conditions.push(eq(issuedCards.type, input.type));
        if (input?.status) conditions.push(eq(issuedCards.status, input.status));
        const rows = await db.select().from(issuedCards)
          .where(conditions.length ? and(...conditions) : undefined);
        if (rows.length > 0) {
          return {
            cards: rows.map(r => ({
              id: r.id, tokenizedPAN: '', last4: r.lastFour,
              scheme: r.scheme, type: r.type,
              issuerBankCode: '', issuerBankName: '', holderName: r.holderName,
              expiryMonth: r.expiryMonth, expiryYear: r.expiryYear,
              status: r.status, dailyLimit: 0, monthlyLimit: 0,
              issuedAt: r.issuedAt, is3DSEnrolled: false,
            })),
            total: rows.length,
            _source: 'DB' as const,
            summary: {
              totalCards: rows.length,
              activeCards: rows.filter(r => r.status === 'active').length,
              visa: rows.filter(r => r.scheme === 'VISA').length,
              mastercard: rows.filter(r => r.scheme === 'MASTERCARD').length,
              verve: rows.filter(r => r.scheme === 'VERVE').length,
            },
          };
        }
      }
      let cards = [...seedCards];
      if (input?.scheme) cards = cards.filter(c => c.scheme === input.scheme);
      if (input?.type) cards = cards.filter(c => c.type === input.type);
      if (input?.status) cards = cards.filter(c => c.status === input.status);
      return {
        cards,
        total: cards.length,
        _source: 'SEED' as const,
        summary: {
          totalCards: seedCards.length,
          activeCards: seedCards.filter(c => c.status === 'active').length,
          visa: seedCards.filter(c => c.scheme === 'VISA').length,
          mastercard: seedCards.filter(c => c.scheme === 'MASTERCARD').length,
          verve: seedCards.filter(c => c.scheme === 'VERVE').length,
        },
      };
    }),

  listTransactions: protectedProcedure
    .input(z.object({ scheme: z.string().optional(), channel: z.string().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      if (db) {
        const conditions = [];
        if (input?.status) conditions.push(eq(cardTransactions.status, input.status));
        if (input?.scheme) conditions.push(eq(cardTransactions.type, input.scheme));
        const rows = await db.select().from(cardTransactions)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(cardTransactions.createdAt));
        if (rows.length > 0) {
          const approved = rows.filter(r => r.status === 'approved');
          return {
            transactions: rows.map(r => ({
              id: r.id, authCode: r.authCode ?? '', rrn: '', type: r.type,
              cardLast4: '', scheme: '', merchantName: r.merchantName,
              merchantCategory: '', terminalId: '', channel: '',
              amount: Number(r.amount), feeAmount: 0, status: r.status,
              declineReason: '', is3DSVerified: false, riskScore: 0,
              processedAt: r.createdAt,
            })),
            total: rows.length,
            _source: 'DB' as const,
            summary: {
              totalTxns: rows.length,
              approved: approved.length,
              declined: rows.filter(r => r.status === 'declined').length,
              totalVolumeNGN: approved.reduce((s, r) => s + Number(r.amount), 0),
              totalFeesNGN: 0,
              approvalRate: (approved.length / rows.length * 100).toFixed(1),
              avgRiskScore: '0',
            },
          };
        }
      }
      let txns = [...seedTxns];
      if (input?.scheme) txns = txns.filter(t => t.scheme === input.scheme);
      if (input?.channel) txns = txns.filter(t => t.channel === input.channel);
      if (input?.status) txns = txns.filter(t => t.status === input.status);
      const approved = seedTxns.filter(t => t.status === 'approved');
      return {
        transactions: txns,
        total: txns.length,
        _source: 'SEED' as const,
        summary: {
          totalTxns: seedTxns.length,
          approved: approved.length,
          declined: seedTxns.filter(t => t.status === 'declined').length,
          totalVolumeNGN: approved.reduce((s, t) => s + t.amount, 0),
          totalFeesNGN: approved.reduce((s, t) => s + t.feeAmount, 0),
          approvalRate: (approved.length / seedTxns.length * 100).toFixed(1),
          avgRiskScore: (seedTxns.reduce((s, t) => s + t.riskScore, 0) / seedTxns.length).toFixed(1),
        },
      };
    }),

  listChargebacks: protectedProcedure.query(async () => {
    const db = await getDb();
    if (db) {
      const rows = await db.select().from(chargebacks);
      if (rows.length > 0) {
        return {
          chargebacks: rows.map(r => ({
            id: r.id, transactionId: r.transactionId,
            originalAmount: Number(r.amount), disputeAmount: Number(r.amount),
            reasonCode: r.reason, reasonDesc: r.reason,
            cardholderName: '', merchantName: '', status: r.status,
            filedAt: r.createdAt, dueDate: r.resolvedAt ?? r.createdAt,
            resolution: '',
          })),
          totalActive: rows.filter(r => !['resolved', 'lost'].includes(r.status)).length,
          totalDisputeAmount: rows.reduce((s, r) => s + Number(r.amount), 0),
          _source: 'DB' as const,
        };
      }
    }
    return {
      chargebacks: seedChargebacks,
      totalActive: seedChargebacks.filter(c => !['resolved', 'lost'].includes(c.status)).length,
      totalDisputeAmount: seedChargebacks.reduce((s, c) => s + c.disputeAmount, 0),
      _source: 'SEED' as const,
    };
  }),

  listTerminals: protectedProcedure.query(async () => ({
    terminals: seedTerminals,
    totalActive: seedTerminals.filter(t => t.status === 'active').length,
    totalDailyVolume: seedTerminals.reduce((s, t) => s + t.dailyVolume, 0),
    _source: 'SEED' as const,
  })),

  blockCard: protectedProcedure
    .input(z.object({ cardId: z.string(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { isAdmin } = getScope(ctx.user as { role: string });
      if (!isAdmin) throw new TRPCError({ code: 'FORBIDDEN' });
      const card = seedCards.find(c => c.id === input.cardId);
      if (!card) throw new TRPCError({ code: 'NOT_FOUND' });
      card.status = 'blocked';
      return card;
    }),

  unblockCard: protectedProcedure
    .input(z.object({ cardId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { isAdmin } = getScope(ctx.user as { role: string });
      if (!isAdmin) throw new TRPCError({ code: 'FORBIDDEN' });
      const card = seedCards.find(c => c.id === input.cardId);
      if (!card) throw new TRPCError({ code: 'NOT_FOUND' });
      card.status = 'active';
      return card;
    }),

  resolveChargeback: protectedProcedure
    .input(z.object({ chargebackId: z.string(), resolution: z.enum(['merchant_win', 'cardholder_win', 'split']) }))
    .mutation(async ({ ctx, input }) => {
      const { isAdmin } = getScope(ctx.user as { role: string });
      if (!isAdmin) throw new TRPCError({ code: 'FORBIDDEN' });
      const cb = seedChargebacks.find(c => c.id === input.chargebackId);
      if (!cb) throw new TRPCError({ code: 'NOT_FOUND' });
      cb.status = 'resolved';
      cb.resolution = input.resolution;
      return cb;
    }),
});
