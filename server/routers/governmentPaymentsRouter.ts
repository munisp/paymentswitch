import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { protectedProcedure, router } from '../_core/trpc';

// --- Types & Seed Data ---

type GovernmentPayment = {
  id: string;
  category: string;
  status: string;
  payerName: string;
  payerTin: string;
  beneficiaryMda: string;
  amount: number;
  tsaCode: string;
  revenueCode: string;
  narration: string;
  completedAt: Date | null;
  gifmisRef: string;
};

type TaxPayment = {
  id: string;
  taxType: string;
  payerName: string;
  payerTin: string;
  assessmentYear: number;
  taxOffice: string;
  amount: number;
  penalty: number;
  interest: number;
  totalAmount: number;
  status: string;
  paidAt: Date | null;
  receiptNumber: string;
};

type PensionRemittance = {
  id: string;
  employerName: string;
  employerRc: string;
  pfaName: string;
  pfaCode: string;
  employeeCount: number;
  employerContribution: number;
  employeeContribution: number;
  voluntaryContribution: number;
  totalAmount: number;
  period: string;
  status: string;
  confirmedAt: Date | null;
};

type SocialDisbursement = {
  id: string;
  programName: string;
  programCode: string;
  beneficiaryCount: number;
  amountPerBeneficiary: number;
  totalAmount: number;
  disbursedCount: number;
  failedCount: number;
  status: string;
  initiatedBy: string;
};

type RegulatoryReport = {
  id: string;
  reportType: string;
  period: string;
  status: string;
  recordCount: number;
  totalValue: number;
  submittedTo: string;
  reference: string;
  generatedAt: Date;
};

const seedGovPayments: GovernmentPayment[] = [
  { id: 'GOV-001', category: 'TSA_COLLECTION', status: 'COMPLETED', payerName: 'Revenue Collection Agent 1', payerTin: 'TIN10000001', beneficiaryMda: 'Federal Ministry of Finance', amount: 450_000_000, tsaCode: 'TSA-001-FMF', revenueCode: 'REV-1000', narration: 'TSA collection for Federal Ministry of Finance', completedAt: new Date('2026-05-01T06:00:00Z'), gifmisRef: 'GIFMIS-A1B2C3' },
  { id: 'GOV-002', category: 'TSA_COLLECTION', status: 'COMPLETED', payerName: 'Revenue Collection Agent 2', payerTin: 'TIN10000002', beneficiaryMda: 'Nigeria Customs Service', amount: 1_200_000_000, tsaCode: 'TSA-002-NCS', revenueCode: 'REV-1001', narration: 'TSA collection for Nigeria Customs Service', completedAt: new Date('2026-05-01T09:00:00Z'), gifmisRef: 'GIFMIS-D4E5F6' },
  { id: 'GOV-003', category: 'TSA_COLLECTION', status: 'COMPLETED', payerName: 'Revenue Collection Agent 3', payerTin: 'TIN10000003', beneficiaryMda: 'Federal Ministry of Health', amount: 89_000_000, tsaCode: 'TSA-003-FMH', revenueCode: 'REV-1002', narration: 'TSA collection for Federal Ministry of Health', completedAt: new Date('2026-05-01T12:00:00Z'), gifmisRef: 'GIFMIS-G7H8I9' },
  { id: 'GOV-004', category: 'TSA_COLLECTION', status: 'PROCESSING', payerName: 'Revenue Collection Agent 4', payerTin: 'TIN10000004', beneficiaryMda: 'Federal Ministry of Education', amount: 156_000_000, tsaCode: 'TSA-004-FME', revenueCode: 'REV-1003', narration: 'TSA collection for Federal Ministry of Education', completedAt: null, gifmisRef: '' },
  { id: 'GOV-005', category: 'TSA_COLLECTION', status: 'COMPLETED', payerName: 'Revenue Collection Agent 5', payerTin: 'TIN10000005', beneficiaryMda: 'NNPC Ltd', amount: 8_500_000_000, tsaCode: 'TSA-005-NNPC', revenueCode: 'REV-1004', narration: 'TSA collection for NNPC Ltd', completedAt: new Date('2026-05-01T15:00:00Z'), gifmisRef: 'GIFMIS-J1K2L3' },
];

const seedTaxPayments: TaxPayment[] = [
  { id: 'TAX-001', taxType: 'CIT', payerName: 'Dangote Industries', payerTin: 'TIN20001', assessmentYear: 2025, taxOffice: 'FIRS Lagos', amount: 2_500_000_000, penalty: 0, interest: 0, totalAmount: 2_500_000_000, status: 'paid', paidAt: new Date('2026-04-30'), receiptNumber: 'FIRS-2026-001' },
  { id: 'TAX-002', taxType: 'VAT', payerName: 'MTN Nigeria', payerTin: 'TIN20002', assessmentYear: 2026, taxOffice: 'FIRS Abuja', amount: 890_000_000, penalty: 0, interest: 0, totalAmount: 890_000_000, status: 'paid', paidAt: new Date('2026-04-30'), receiptNumber: 'FIRS-2026-002' },
  { id: 'TAX-003', taxType: 'WHT', payerName: 'Access Bank Plc', payerTin: 'TIN20003', assessmentYear: 2026, taxOffice: 'FIRS Lagos', amount: 340_000_000, penalty: 0, interest: 0, totalAmount: 340_000_000, status: 'paid', paidAt: new Date('2026-04-30'), receiptNumber: 'FIRS-2026-003' },
  { id: 'TAX-004', taxType: 'PIT', payerName: 'Lagos State PAYE', payerTin: 'TIN20004', assessmentYear: 2026, taxOffice: 'LIRS Ikeja', amount: 1_200_000, penalty: 120_000, interest: 36_000, totalAmount: 1_356_000, status: 'overdue', paidAt: null, receiptNumber: '' },
  { id: 'TAX-005', taxType: 'STAMP_DUTY', payerName: 'Globacom Ltd', payerTin: 'TIN20005', assessmentYear: 2026, taxOffice: 'FIRS Abuja', amount: 45_000_000, penalty: 0, interest: 0, totalAmount: 45_000_000, status: 'paid', paidAt: new Date('2026-04-28'), receiptNumber: 'FIRS-2026-005' },
];

const seedPensions: PensionRemittance[] = [
  { id: 'PEN-001', employerName: 'Federal Civil Service Commission', employerRc: 'RC100001', pfaName: 'Stanbic IBTC Pension', pfaCode: 'PENCOM-001', employeeCount: 2500, employerContribution: 11_250_000, employeeContribution: 9_000_000, voluntaryContribution: 500_000, totalAmount: 20_750_000, period: '2026-04', status: 'confirmed', confirmedAt: new Date('2026-04-30') },
  { id: 'PEN-002', employerName: 'Federal Civil Service Commission', employerRc: 'RC100001', pfaName: 'ARM Pension Managers', pfaCode: 'PENCOM-002', employeeCount: 1800, employerContribution: 8_100_000, employeeContribution: 6_480_000, voluntaryContribution: 350_000, totalAmount: 14_930_000, period: '2026-04', status: 'confirmed', confirmedAt: new Date('2026-04-30') },
  { id: 'PEN-003', employerName: 'Federal Civil Service Commission', employerRc: 'RC100001', pfaName: 'Leadway Pensure', pfaCode: 'PENCOM-003', employeeCount: 3200, employerContribution: 14_400_000, employeeContribution: 11_520_000, voluntaryContribution: 800_000, totalAmount: 26_720_000, period: '2026-04', status: 'submitted', confirmedAt: null },
];

const seedSocialDisbursements: SocialDisbursement[] = [
  { id: 'SOC-001', programName: 'N-Power Stipend', programCode: 'NSIP-001', beneficiaryCount: 500_000, amountPerBeneficiary: 30_000, totalAmount: 15_000_000_000, disbursedCount: 475_000, failedCount: 25_000, status: 'completed', initiatedBy: 'Federal Ministry of Humanitarian Affairs' },
  { id: 'SOC-002', programName: 'Conditional Cash Transfer', programCode: 'CCT-001', beneficiaryCount: 1_200_000, amountPerBeneficiary: 5_000, totalAmount: 6_000_000_000, disbursedCount: 1_140_000, failedCount: 60_000, status: 'completed', initiatedBy: 'Federal Ministry of Humanitarian Affairs' },
  { id: 'SOC-003', programName: 'Trader Moni', programCode: 'TM-001', beneficiaryCount: 300_000, amountPerBeneficiary: 10_000, totalAmount: 3_000_000_000, disbursedCount: 180_000, failedCount: 5_000, status: 'disbursing', initiatedBy: 'Bank of Industry' },
];

const seedReports: RegulatoryReport[] = [
  { id: 'RPT-001', reportType: 'BOP_RETURN', period: '2026-Q1', status: 'submitted', recordCount: 45_230, totalValue: 128_000_000_000, submittedTo: 'CBN', reference: 'CBN-BOP-2026-Q1', generatedAt: new Date('2026-04-15') },
  { id: 'RPT-002', reportType: 'EFORM_M', period: '2026-04', status: 'submitted', recordCount: 8_450, totalValue: 34_500_000_000, submittedTo: 'CBN', reference: 'CBN-EFM-2026-04', generatedAt: new Date('2026-05-01') },
  { id: 'RPT-003', reportType: 'FORM_A', period: '2026-04', status: 'generated', recordCount: 3_200, totalValue: 12_800_000_000, submittedTo: 'CBN', reference: 'CBN-FA-2026-04', generatedAt: new Date('2026-05-01') },
  { id: 'RPT-004', reportType: 'NFIU_STR', period: '2026-04', status: 'submitted', recordCount: 124, totalValue: 2_340_000_000, submittedTo: 'NFIU', reference: 'NFIU-STR-2026-04', generatedAt: new Date('2026-05-01') },
  { id: 'RPT-005', reportType: 'CBN_MONTHLY', period: '2026-04', status: 'draft', recordCount: 0, totalValue: 0, submittedTo: 'CBN', reference: 'CBN-MONTHLY-2026-04', generatedAt: new Date('2026-05-02') },
];

function getScope(user: { role: string }) {
  return { isAdmin: user.role === 'admin' || user.role === 'cbn' };
}

export const governmentPaymentsRouter = router({
  listGovernmentPayments: protectedProcedure
    .input(z.object({ category: z.string().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      let payments = [...seedGovPayments];
      if (input?.category) payments = payments.filter(p => p.category === input.category);
      if (input?.status) payments = payments.filter(p => p.status === input.status);
      return {
        payments,
        total: payments.length,
        _source: 'SEED' as const,
        summary: {
          totalCollections: seedGovPayments.length,
          completed: seedGovPayments.filter(p => p.status === 'COMPLETED').length,
          totalValueNGN: seedGovPayments.filter(p => p.status === 'COMPLETED').reduce((s, p) => s + p.amount, 0),
        },
      };
    }),

  listTaxPayments: protectedProcedure
    .input(z.object({ taxType: z.string().optional(), status: z.string().optional() }).optional())
    .query(async ({ input }) => {
      let taxes = [...seedTaxPayments];
      if (input?.taxType) taxes = taxes.filter(t => t.taxType === input.taxType);
      if (input?.status) taxes = taxes.filter(t => t.status === input.status);
      return {
        taxes,
        total: taxes.length,
        _source: 'SEED' as const,
        totalPaidNGN: seedTaxPayments.filter(t => t.status === 'paid').reduce((s, t) => s + t.totalAmount, 0),
      };
    }),

  listPensions: protectedProcedure.query(async () => ({
    pensions: seedPensions,
    totalContributions: seedPensions.reduce((s, p) => s + p.totalAmount, 0),
    totalEmployees: seedPensions.reduce((s, p) => s + p.employeeCount, 0),
    _source: 'SEED' as const,
  })),

  listSocialDisbursements: protectedProcedure.query(async () => ({
    disbursements: seedSocialDisbursements,
    totalBeneficiaries: seedSocialDisbursements.reduce((s, d) => s + d.beneficiaryCount, 0),
    totalDisbursed: seedSocialDisbursements.reduce((s, d) => s + d.totalAmount, 0),
    _source: 'SEED' as const,
  })),

  listRegulatoryReports: protectedProcedure.query(async () => ({
    reports: seedReports,
    totalSubmitted: seedReports.filter(r => r.status === 'submitted').length,
    pendingSubmission: seedReports.filter(r => ['draft', 'generated'].includes(r.status)).length,
    _source: 'SEED' as const,
  })),

  generateReport: protectedProcedure
    .input(z.object({
      reportType: z.enum(['BOP_RETURN', 'EFORM_M', 'FORM_A', 'NFIU_STR', 'CBN_MONTHLY', 'GIFMIS_RECONCILIATION']),
      period: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { isAdmin } = getScope(ctx.user as { role: string });
      if (!isAdmin) throw new TRPCError({ code: 'FORBIDDEN' });
      const report: RegulatoryReport = {
        id: `RPT-${Date.now()}`,
        reportType: input.reportType,
        period: input.period,
        status: 'generated',
        recordCount: 0,
        totalValue: 0,
        submittedTo: input.reportType === 'NFIU_STR' ? 'NFIU' : 'CBN',
        reference: `${input.reportType}-${input.period}`,
        generatedAt: new Date(),
      };
      seedReports.push(report);
      return report;
    }),

  submitReport: protectedProcedure
    .input(z.object({ reportId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { isAdmin } = getScope(ctx.user as { role: string });
      if (!isAdmin) throw new TRPCError({ code: 'FORBIDDEN' });
      const report = seedReports.find(r => r.id === input.reportId);
      if (!report) throw new TRPCError({ code: 'NOT_FOUND' });
      report.status = 'submitted';
      return report;
    }),

  initiateBulkDisbursement: protectedProcedure
    .input(z.object({
      programName: z.string(),
      programCode: z.string(),
      beneficiaries: z.array(z.object({
        id: z.string(),
        name: z.string(),
        accountNumber: z.string(),
        bankCode: z.string(),
        amount: z.number().positive(),
        nin: z.string().optional(),
        bvn: z.string().optional(),
      })).min(1),
      channelPreference: z.enum(['NIP', 'MOBILE_MONEY', 'AGENT_CASH']).default('NIP'),
      initiatedBy: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { isAdmin } = getScope(ctx.user as { role: string });
      if (!isAdmin) throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admin/CBN can initiate bulk disbursements' });

      const totalAmount = input.beneficiaries.reduce((s, b) => s + b.amount, 0);
      const disbursement: SocialDisbursement = {
        id: `SOC-${Date.now()}`,
        programName: input.programName,
        programCode: input.programCode,
        beneficiaryCount: input.beneficiaries.length,
        amountPerBeneficiary: totalAmount / input.beneficiaries.length,
        totalAmount,
        disbursedCount: 0,
        failedCount: 0,
        status: 'initiated',
        initiatedBy: input.initiatedBy,
      };
      seedSocialDisbursements.push(disbursement);

      return {
        disbursement,
        trackingId: disbursement.id,
        estimatedCompletionMinutes: Math.ceil(input.beneficiaries.length / 500),
        validatedBeneficiaries: input.beneficiaries.length,
        totalAmountNGN: totalAmount,
        channel: input.channelPreference,
      };
    }),

  getDisbursementProgress: protectedProcedure
    .input(z.object({ disbursementId: z.string() }))
    .query(async ({ input }) => {
      const disbursement = seedSocialDisbursements.find(d => d.id === input.disbursementId);
      if (!disbursement) throw new TRPCError({ code: 'NOT_FOUND' });

      const successRate = disbursement.beneficiaryCount > 0
        ? (disbursement.disbursedCount / disbursement.beneficiaryCount) * 100
        : 0;
      const pending = disbursement.beneficiaryCount - disbursement.disbursedCount - disbursement.failedCount;

      return {
        id: disbursement.id,
        programName: disbursement.programName,
        status: disbursement.status,
        progress: {
          total: disbursement.beneficiaryCount,
          disbursed: disbursement.disbursedCount,
          failed: disbursement.failedCount,
          pending,
          successRate: parseFloat(successRate.toFixed(2)),
          percentComplete: parseFloat(((disbursement.disbursedCount + disbursement.failedCount) / disbursement.beneficiaryCount * 100).toFixed(2)),
        },
        amounts: {
          totalAllocated: disbursement.totalAmount,
          totalDisbursed: disbursement.amountPerBeneficiary * disbursement.disbursedCount,
          totalFailed: disbursement.amountPerBeneficiary * disbursement.failedCount,
          totalPending: disbursement.amountPerBeneficiary * pending,
        },
      };
    }),

  retryFailedDisbursements: protectedProcedure
    .input(z.object({ disbursementId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { isAdmin } = getScope(ctx.user as { role: string });
      if (!isAdmin) throw new TRPCError({ code: 'FORBIDDEN' });

      const disbursement = seedSocialDisbursements.find(d => d.id === input.disbursementId);
      if (!disbursement) throw new TRPCError({ code: 'NOT_FOUND' });
      if (disbursement.failedCount === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No failed disbursements to retry' });

      const retryCount = disbursement.failedCount;
      return {
        retryBatchId: `RETRY-${disbursement.id}-${Date.now()}`,
        retryCount,
        estimatedCompletionMinutes: Math.ceil(retryCount / 500),
        status: 'retry_initiated',
      };
    }),

  getDisbursementReconciliation: protectedProcedure
    .input(z.object({ disbursementId: z.string() }))
    .query(async ({ input }) => {
      const disbursement = seedSocialDisbursements.find(d => d.id === input.disbursementId);
      if (!disbursement) throw new TRPCError({ code: 'NOT_FOUND' });

      return {
        disbursementId: disbursement.id,
        programName: disbursement.programName,
        reconciliation: {
          allocated: disbursement.totalAmount,
          disbursed: disbursement.amountPerBeneficiary * disbursement.disbursedCount,
          failed: disbursement.amountPerBeneficiary * disbursement.failedCount,
          variance: 0,
          reconciledAt: new Date().toISOString(),
          status: disbursement.failedCount === 0 ? 'fully_reconciled' : 'partial_reconciliation',
        },
        auditTrail: [
          { action: 'initiated', timestamp: new Date(Date.now() - 86400000).toISOString(), actor: disbursement.initiatedBy },
          { action: 'disbursement_started', timestamp: new Date(Date.now() - 82800000).toISOString(), actor: 'system' },
          { action: 'reconciliation_generated', timestamp: new Date().toISOString(), actor: 'system' },
        ],
      };
    }),
});
