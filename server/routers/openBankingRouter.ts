import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { tpps, consents } from "../../drizzle/payments-schema";
import { eq, and, desc } from "drizzle-orm";

// --- Types & Seed Data ---

type TPP = {
  id: string;
  name: string;
  registrationNumber: string;
  cbnLicense: string;
  services: string[];
  status: string;
  apiTier: string;
  clientId: string;
  webhookUrl: string;
  contactEmail: string;
  monthlyApiCalls: number;
  rateLimitPerMin: number;
  registeredAt: Date;
};

type Consent = {
  id: string;
  customerId: string;
  customerName: string;
  tppId: string;
  tppName: string;
  serviceType: string;
  status: string;
  permissions: string[];
  accounts: string[];
  validFrom: Date;
  validUntil: Date;
  authorizedAt: Date | null;
  revokedAt: Date | null;
};

type APIEndpoint = {
  id: string;
  path: string;
  method: string;
  description: string;
  serviceType: string;
  version: string;
  isPublic: boolean;
  avgLatencyMs: number;
  callsLast24h: number;
};

type SandboxEnv = {
  id: string;
  tppId: string;
  tppName: string;
  status: string;
  testApiKey: string;
  testAccounts: {
    id: string;
    name: string;
    balance: number;
    currency: string;
    type: string;
  }[];
  totalTestCalls: number;
  createdAt: Date;
};

const seedTPPs: TPP[] = [
  {
    id: "TPP-001",
    name: "Paystack",
    registrationNumber: "RC1234567",
    cbnLicense: "CBN/OB/2024/001",
    services: ["AIS", "PIS"],
    status: "ACTIVE",
    apiTier: "ENTERPRISE",
    clientId: "cli_paystack_prod",
    webhookUrl: "https://api.paystack.co/webhooks/openbanking",
    contactEmail: "api@paystack.com",
    monthlyApiCalls: 850_000,
    rateLimitPerMin: 1000,
    registeredAt: new Date("2024-06-15"),
  },
  {
    id: "TPP-002",
    name: "Flutterwave",
    registrationNumber: "RC2345678",
    cbnLicense: "CBN/OB/2024/002",
    services: ["AIS", "PIS"],
    status: "ACTIVE",
    apiTier: "ENTERPRISE",
    clientId: "cli_flutterwave_prod",
    webhookUrl: "https://api.flutterwave.com/webhooks/ob",
    contactEmail: "api@flutterwave.com",
    monthlyApiCalls: 720_000,
    rateLimitPerMin: 1000,
    registeredAt: new Date("2024-07-01"),
  },
  {
    id: "TPP-003",
    name: "Mono",
    registrationNumber: "RC3456789",
    cbnLicense: "CBN/OB/2024/003",
    services: ["AIS"],
    status: "ACTIVE",
    apiTier: "GROWTH",
    clientId: "cli_mono_prod",
    webhookUrl: "https://api.mono.co/webhooks",
    contactEmail: "developer@mono.co",
    monthlyApiCalls: 450_000,
    rateLimitPerMin: 500,
    registeredAt: new Date("2024-08-10"),
  },
  {
    id: "TPP-004",
    name: "Okra",
    registrationNumber: "RC4567890",
    cbnLicense: "CBN/OB/2024/004",
    services: ["AIS"],
    status: "ACTIVE",
    apiTier: "GROWTH",
    clientId: "cli_okra_prod",
    webhookUrl: "https://api.okra.ng/webhooks",
    contactEmail: "dev@okra.ng",
    monthlyApiCalls: 380_000,
    rateLimitPerMin: 500,
    registeredAt: new Date("2024-09-05"),
  },
  {
    id: "TPP-005",
    name: "Stitch",
    registrationNumber: "RC5678901",
    cbnLicense: "CBN/OB/2024/005",
    services: ["AIS", "PIS"],
    status: "ACTIVE",
    apiTier: "STARTER",
    clientId: "cli_stitch_prod",
    webhookUrl: "https://api.stitch.money/webhooks",
    contactEmail: "api@stitch.money",
    monthlyApiCalls: 120_000,
    rateLimitPerMin: 200,
    registeredAt: new Date("2024-10-20"),
  },
  {
    id: "TPP-006",
    name: "OnePipe",
    registrationNumber: "RC6789012",
    cbnLicense: "CBN/OB/2024/006",
    services: ["PIS"],
    status: "ACTIVE",
    apiTier: "STARTER",
    clientId: "cli_onepipe_prod",
    webhookUrl: "https://api.onepipe.io/webhooks",
    contactEmail: "dev@onepipe.io",
    monthlyApiCalls: 95_000,
    rateLimitPerMin: 200,
    registeredAt: new Date("2024-11-15"),
  },
  {
    id: "TPP-007",
    name: "Bloc",
    registrationNumber: "RC7890123",
    cbnLicense: "CBN/OB/2024/007",
    services: ["AIS", "PIS"],
    status: "REGISTERED",
    apiTier: "SANDBOX",
    clientId: "cli_bloc_test",
    webhookUrl: "https://api.bloc.co/webhooks",
    contactEmail: "dev@bloc.co",
    monthlyApiCalls: 0,
    rateLimitPerMin: 60,
    registeredAt: new Date("2026-04-01"),
  },
  {
    id: "TPP-008",
    name: "Paga",
    registrationNumber: "RC8901234",
    cbnLicense: "CBN/OB/2024/008",
    services: ["PIS"],
    status: "ACTIVE",
    apiTier: "GROWTH",
    clientId: "cli_paga_prod",
    webhookUrl: "https://api.mypaga.com/webhooks",
    contactEmail: "api@mypaga.com",
    monthlyApiCalls: 210_000,
    rateLimitPerMin: 500,
    registeredAt: new Date("2025-01-10"),
  },
];

const seedConsents: Consent[] = [
  {
    id: "CON-001",
    customerId: "CUST-10000",
    customerName: "Adebayo Ogunlade",
    tppId: "TPP-001",
    tppName: "Paystack",
    serviceType: "AIS",
    status: "AUTHORIZED",
    permissions: ["ReadAccountsBasic", "ReadBalances", "ReadTransactionsBasic"],
    accounts: ["0044100001", "0044100002"],
    validFrom: new Date("2026-04-01"),
    validUntil: new Date("2026-07-01"),
    authorizedAt: new Date("2026-04-01"),
    revokedAt: null,
  },
  {
    id: "CON-002",
    customerId: "CUST-10001",
    customerName: "Chioma Okafor",
    tppId: "TPP-002",
    tppName: "Flutterwave",
    serviceType: "PIS",
    status: "AUTHORIZED",
    permissions: ["CreatePayment", "ReadPaymentStatus"],
    accounts: ["0058200002"],
    validFrom: new Date("2026-03-15"),
    validUntil: new Date("2026-06-15"),
    authorizedAt: new Date("2026-03-15"),
    revokedAt: null,
  },
  {
    id: "CON-003",
    customerId: "CUST-10002",
    customerName: "Emeka Nwosu",
    tppId: "TPP-003",
    tppName: "Mono",
    serviceType: "AIS",
    status: "AUTHORIZED",
    permissions: [
      "ReadAccountsBasic",
      "ReadBalances",
      "ReadTransactionsDetail",
      "ReadStandingOrders",
    ],
    accounts: ["0033400004"],
    validFrom: new Date("2026-02-20"),
    validUntil: new Date("2026-05-20"),
    authorizedAt: new Date("2026-02-20"),
    revokedAt: null,
  },
  {
    id: "CON-004",
    customerId: "CUST-10003",
    customerName: "Fatima Bello",
    tppId: "TPP-004",
    tppName: "Okra",
    serviceType: "AIS",
    status: "REVOKED",
    permissions: ["ReadAccountsBasic", "ReadBalances"],
    accounts: ["0057300006"],
    validFrom: new Date("2026-01-10"),
    validUntil: new Date("2026-04-10"),
    authorizedAt: new Date("2026-01-10"),
    revokedAt: new Date("2026-03-05"),
  },
  {
    id: "CON-005",
    customerId: "CUST-10004",
    customerName: "Tunde Bakare",
    tppId: "TPP-005",
    tppName: "Stitch",
    serviceType: "AIS",
    status: "EXPIRED",
    permissions: ["ReadAccountsBasic"],
    accounts: ["0058200008"],
    validFrom: new Date("2025-11-01"),
    validUntil: new Date("2026-02-01"),
    authorizedAt: new Date("2025-11-01"),
    revokedAt: null,
  },
];

const seedEndpoints: APIEndpoint[] = [
  {
    id: "EP-001",
    path: "/accounts",
    method: "GET",
    description: "List customer accounts",
    serviceType: "AIS",
    version: "v1",
    isPublic: true,
    avgLatencyMs: 45,
    callsLast24h: 12_500,
  },
  {
    id: "EP-002",
    path: "/accounts/{accountId}/balances",
    method: "GET",
    description: "Get account balance",
    serviceType: "AIS",
    version: "v1",
    isPublic: true,
    avgLatencyMs: 32,
    callsLast24h: 28_400,
  },
  {
    id: "EP-003",
    path: "/accounts/{accountId}/transactions",
    method: "GET",
    description: "List account transactions",
    serviceType: "AIS",
    version: "v1",
    isPublic: true,
    avgLatencyMs: 120,
    callsLast24h: 18_600,
  },
  {
    id: "EP-004",
    path: "/accounts/{accountId}/standing-orders",
    method: "GET",
    description: "List standing orders",
    serviceType: "AIS",
    version: "v1",
    isPublic: true,
    avgLatencyMs: 55,
    callsLast24h: 3_200,
  },
  {
    id: "EP-005",
    path: "/payments",
    method: "POST",
    description: "Initiate a payment",
    serviceType: "PIS",
    version: "v1",
    isPublic: true,
    avgLatencyMs: 250,
    callsLast24h: 8_900,
  },
  {
    id: "EP-006",
    path: "/payments/{paymentId}",
    method: "GET",
    description: "Get payment status",
    serviceType: "PIS",
    version: "v1",
    isPublic: true,
    avgLatencyMs: 35,
    callsLast24h: 15_300,
  },
  {
    id: "EP-007",
    path: "/consents",
    method: "POST",
    description: "Create consent request",
    serviceType: "AIS",
    version: "v1",
    isPublic: true,
    avgLatencyMs: 180,
    callsLast24h: 5_400,
  },
  {
    id: "EP-008",
    path: "/consents/{consentId}",
    method: "DELETE",
    description: "Revoke consent",
    serviceType: "AIS",
    version: "v1",
    isPublic: true,
    avgLatencyMs: 90,
    callsLast24h: 1_200,
  },
];

const seedSandboxes: SandboxEnv[] = [
  {
    id: "SBX-001",
    tppId: "TPP-007",
    tppName: "Bloc",
    status: "active",
    // Test sandboxes are disabled until a non-production credential is injected.
    // Production must never expose sandbox credentials through this route.
    testApiKey: process.env.OPEN_BANKING_SANDBOX_API_KEY ?? "",
    testAccounts: [
      {
        id: "TEST-001",
        name: "Test Current Account",
        balance: 5_000_000,
        currency: "NGN",
        type: "current",
      },
      {
        id: "TEST-002",
        name: "Test Savings Account",
        balance: 12_000_000,
        currency: "NGN",
        type: "savings",
      },
    ],
    totalTestCalls: 2_340,
    createdAt: new Date("2026-04-01"),
  },
];

function getScope(user: { role: string }) {
  return { isAdmin: user.role === "admin" || user.role === "cbn" };
}

const seedModeEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.ENABLE_SEED_DATA === "true";

function requireSeedMode(): void {
  if (!seedModeEnabled) {
    throw new TRPCError({
      code: "SERVICE_UNAVAILABLE",
      message: "Open-banking persistence is unavailable; seed data is disabled",
    });
  }
}

export const openBankingRouter = router({
  listTPPs: protectedProcedure
    .input(
      z
        .object({ status: z.string().optional(), tier: z.string().optional() })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (db) {
        const conditions = [];
        if (input?.status) conditions.push(eq(tpps.status, input.status));
        const rows = await db
          .select()
          .from(tpps)
          .where(conditions.length ? and(...conditions) : undefined);
        if (rows.length > 0) {
          return {
            tpps: rows.map(r => ({
              id: r.id,
              name: r.name,
              registrationNumber: "",
              cbnLicense: "",
              services: [] as string[],
              status: r.status,
              apiTier: "",
              clientId: r.clientId,
              webhookUrl: "",
              contactEmail: "",
              monthlyApiCalls: r.apiCallsToday,
              rateLimitPerMin: 0,
              registeredAt: r.registeredAt,
            })),
            total: rows.length,
            _source: "DB" as const,
            summary: {
              totalTPPs: rows.length,
              activeTPPs: rows.filter(r => r.status === "ACTIVE").length,
              totalApiCalls: rows.reduce((s, r) => s + r.apiCallsToday, 0),
              enterprise: 0,
              growth: 0,
              starter: 0,
              sandbox: 0,
            },
          };
        }
      }
      requireSeedMode();
      let filteredTpps = [...seedTPPs];
      if (input?.status)
        filteredTpps = filteredTpps.filter(t => t.status === input.status);
      if (input?.tier)
        filteredTpps = filteredTpps.filter(t => t.apiTier === input.tier);
      return {
        tpps: filteredTpps,
        total: filteredTpps.length,
        _source: "SEED" as const,
        summary: {
          totalTPPs: seedTPPs.length,
          activeTPPs: seedTPPs.filter(t => t.status === "ACTIVE").length,
          totalApiCalls: seedTPPs.reduce((s, t) => s + t.monthlyApiCalls, 0),
          enterprise: seedTPPs.filter(t => t.apiTier === "ENTERPRISE").length,
          growth: seedTPPs.filter(t => t.apiTier === "GROWTH").length,
          starter: seedTPPs.filter(t => t.apiTier === "STARTER").length,
          sandbox: seedTPPs.filter(t => t.apiTier === "SANDBOX").length,
        },
      };
    }),

  listConsents: protectedProcedure
    .input(
      z
        .object({ status: z.string().optional(), tppId: z.string().optional() })
        .optional()
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (db) {
        const conditions = [];
        if (input?.status) conditions.push(eq(consents.status, input.status));
        if (input?.tppId) conditions.push(eq(consents.tppId, input.tppId));
        const rows = await db
          .select()
          .from(consents)
          .where(conditions.length ? and(...conditions) : undefined);
        if (rows.length > 0) {
          return {
            consents: rows.map(r => ({
              id: r.id,
              customerId: r.accountId,
              customerName: "",
              tppId: r.tppId,
              tppName: "",
              serviceType: "",
              status: r.status,
              permissions: r.permissions as string[],
              accounts: [] as string[],
              validFrom: r.createdAt,
              validUntil: r.expiresAt ?? r.createdAt,
              authorizedAt: r.createdAt,
              revokedAt: null as Date | null,
            })),
            total: rows.length,
            _source: "DB" as const,
            summary: {
              totalConsents: rows.length,
              authorized: rows.filter(r => r.status === "AUTHORIZED").length,
              revoked: rows.filter(r => r.status === "REVOKED").length,
              expired: rows.filter(r => r.status === "EXPIRED").length,
            },
          };
        }
      }
      requireSeedMode();
      let filteredConsents = [...seedConsents];
      if (input?.status)
        filteredConsents = filteredConsents.filter(
          c => c.status === input.status
        );
      if (input?.tppId)
        filteredConsents = filteredConsents.filter(
          c => c.tppId === input.tppId
        );
      return {
        consents: filteredConsents,
        total: filteredConsents.length,
        _source: "SEED" as const,
        summary: {
          totalConsents: seedConsents.length,
          authorized: seedConsents.filter(c => c.status === "AUTHORIZED")
            .length,
          revoked: seedConsents.filter(c => c.status === "REVOKED").length,
          expired: seedConsents.filter(c => c.status === "EXPIRED").length,
        },
      };
    }),

  listEndpoints: protectedProcedure.query(async () => {
    requireSeedMode();
    return {
      endpoints: seedEndpoints,
      totalCalls24h: seedEndpoints.reduce((s, e) => s + e.callsLast24h, 0),
      _source: "SEED" as const,
    };
  }),

  listSandboxes: protectedProcedure.query(async () => {
    requireSeedMode();
    return { sandboxes: seedSandboxes, _source: "SEED" as const };
  }),

  registerTPP: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2),
        registrationNumber: z.string(),
        services: z.array(z.enum(["AIS", "PIS", "CBPII"])),
        contactEmail: z.string().email(),
        webhookUrl: z.string().url(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { isAdmin } = getScope(ctx.user as { role: string });
      if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN" });
      requireSeedMode();
      const tpp: TPP = {
        id: `TPP-${Date.now()}`,
        name: input.name,
        registrationNumber: input.registrationNumber,
        cbnLicense: `CBN/OB/2026/${String(seedTPPs.length + 1).padStart(3, "0")}`,
        services: input.services,
        status: "REGISTERED",
        apiTier: "SANDBOX",
        clientId: `cli_${input.name.toLowerCase().replace(/\s/g, "")}_${Date.now()}`,
        webhookUrl: input.webhookUrl,
        contactEmail: input.contactEmail,
        monthlyApiCalls: 0,
        rateLimitPerMin: 60,
        registeredAt: new Date(),
      };
      seedTPPs.push(tpp);
      return tpp;
    }),

  activateTPP: protectedProcedure
    .input(
      z.object({
        tppId: z.string(),
        apiTier: z.enum(["STARTER", "GROWTH", "ENTERPRISE"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { isAdmin } = getScope(ctx.user as { role: string });
      if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN" });
      requireSeedMode();
      const tpp = seedTPPs.find(t => t.id === input.tppId);
      if (!tpp) throw new TRPCError({ code: "NOT_FOUND" });
      tpp.status = "ACTIVE";
      tpp.apiTier = input.apiTier;
      tpp.rateLimitPerMin =
        input.apiTier === "ENTERPRISE"
          ? 1000
          : input.apiTier === "GROWTH"
            ? 500
            : 200;
      return tpp;
    }),

  suspendTPP: protectedProcedure
    .input(z.object({ tppId: z.string(), reason: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { isAdmin } = getScope(ctx.user as { role: string });
      if (!isAdmin) throw new TRPCError({ code: "FORBIDDEN" });
      requireSeedMode();
      const tpp = seedTPPs.find(t => t.id === input.tppId);
      if (!tpp) throw new TRPCError({ code: "NOT_FOUND" });
      tpp.status = "SUSPENDED";
      return tpp;
    }),

  revokeConsent: protectedProcedure
    .input(z.object({ consentId: z.string() }))
    .mutation(async ({ input }) => {
      requireSeedMode();
      const consent = seedConsents.find(c => c.id === input.consentId);
      if (!consent) throw new TRPCError({ code: "NOT_FOUND" });
      consent.status = "REVOKED";
      consent.revokedAt = new Date();
      return consent;
    }),

  createSandbox: protectedProcedure
    .input(z.object({ tppId: z.string() }))
    .mutation(async ({ input }) => {
      requireSeedMode();
      const tpp = seedTPPs.find(t => t.id === input.tppId);
      if (!tpp) throw new TRPCError({ code: "NOT_FOUND" });
      requireSeedMode();
      const sandbox: SandboxEnv = {
        id: `SBX-${Date.now()}`,
        tppId: input.tppId,
        tppName: tpp.name,
        status: "active",
        testApiKey: `sbx_test_${tpp.name.toLowerCase().replace(/\s/g, "")}_${Date.now()}`,
        testAccounts: [
          {
            id: "TEST-001",
            name: "Test Current Account",
            balance: 5_000_000,
            currency: "NGN",
            type: "current",
          },
          {
            id: "TEST-002",
            name: "Test Savings Account",
            balance: 12_000_000,
            currency: "NGN",
            type: "savings",
          },
          {
            id: "TEST-003",
            name: "Test USD Account",
            balance: 25_000,
            currency: "USD",
            type: "domiciliary",
          },
        ],
        totalTestCalls: 0,
        createdAt: new Date(),
      };
      seedSandboxes.push(sandbox);
      return sandbox;
    }),
});
