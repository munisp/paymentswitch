import { z } from 'zod';
import { router, protectedProcedure } from '../_core/trpc';
import { createChildLogger } from '../lib/logger';
import {
  getMobileMoneyProviders,
  detectProviderFromPhone,
  validateMobileMoneyAccount,
  sendMobileMoneyTransfer,
  getMobileMoneyTransferStatus,
  checkMobileMoneyBalance,
  getMobileMoneyHistory,
} from '../services/mobileMoneyService';

const log = createChildLogger('mobileMoney');

export const mobileMoneyRouter = router({
  getProviders: protectedProcedure.query(() => {
    return getMobileMoneyProviders();
  }),

  detectProvider: protectedProcedure
    .input(z.object({ phoneNumber: z.string() }))
    .query(({ input }) => {
      const provider = detectProviderFromPhone(input.phoneNumber);
      return { provider };
    }),

  validateAccount: protectedProcedure
    .input(z.object({
      provider: z.string(),
      phoneNumber: z.string(),
    }))
    .query(async ({ input }) => {
      return await validateMobileMoneyAccount({
        provider: input.provider,
        phoneNumber: input.phoneNumber,
      });
    }),

  transfer: protectedProcedure
    .input(z.object({
      provider: z.string(),
      recipientPhone: z.string(),
      amount: z.number().positive(),
      narration: z.string().optional(),
      idempotencyKey: z.string().min(16).max(128),
    }))
    .mutation(async ({ ctx, input }) => {
      log.info({ provider: input.provider, amount: input.amount, userId: ctx.user.id }, 'Mobile money transfer initiated');
      return await sendMobileMoneyTransfer({
        ownerId: String(ctx.user.id),
        idempotencyKey: input.idempotencyKey,
        remittanceId: `REM-${ctx.user.id}-${input.idempotencyKey}`,
        provider: input.provider,
        recipientPhone: input.recipientPhone,
        amount: input.amount,
        narration: input.narration,
      });
    }),

  getTransferStatus: protectedProcedure
    .input(z.object({ reference: z.string() }))
    .query(async ({ ctx, input }) => {
      return await getMobileMoneyTransferStatus(String(ctx.user.id), input.reference);
    }),

  checkBalance: protectedProcedure
    .input(z.object({
      provider: z.string(),
      phoneNumber: z.string(),
    }))
    .query(async ({ input }) => {
      return await checkMobileMoneyBalance({
        provider: input.provider,
        phoneNumber: input.phoneNumber,
      });
    }),

  getHistory: protectedProcedure
    .input(z.object({
      provider: z.string().optional(),
      limit: z.number().min(1).max(100).optional().default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      return await getMobileMoneyHistory({
        ownerId: String(ctx.user.id),
        provider: input?.provider,
        limit: input?.limit ?? 20,
      });
    }),
});
