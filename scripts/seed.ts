/**
 * Unified Seed Script — National Payment Switch
 *
 * Populates ALL PostgreSQL tables with realistic Nigerian financial data.
 * Usage: npx tsx scripts/seed.ts
 *
 * Prerequisites:
 *   DATABASE_URL=postgresql://user:pass@localhost:5432/payment_switch
 *
 * Idempotent: Uses ON CONFLICT DO NOTHING for all inserts.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../drizzle/schema";

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/payment_switch";

// ── Realistic Nigerian Data Constants ──────────────────────────────────

const NIGERIAN_NAMES = [
  { first: "Adewale", last: "Johnson", email: "adewale.johnson@gmail.com" },
  { first: "Chioma", last: "Okafor", email: "chioma.okafor@yahoo.com" },
  { first: "Babajide", last: "Sanwo-Olu", email: "babajide.sanwo@outlook.com" },
  { first: "Ngozi", last: "Okonjo-Iweala", email: "ngozi.okonjo@hotmail.com" },
  { first: "Emeka", last: "Obiora", email: "emeka.obiora@gmail.com" },
  { first: "Funmilayo", last: "Adeyemi", email: "funmi.adeyemi@paystack.com" },
  { first: "Tunde", last: "Bakare", email: "tunde.bakare@flutterwave.com" },
  { first: "Amina", last: "Mohammed", email: "amina.mohammed@kuda.com" },
  { first: "Oluwaseun", last: "Adesanya", email: "seun.adesanya@interswitch.com" },
  { first: "Ifeoma", last: "Nwachukwu", email: "ifeoma.nwachukwu@zenithbank.com" },
  { first: "Yusuf", last: "Buhari", email: "yusuf.buhari@gtbank.com" },
  { first: "Kelechi", last: "Iheanacho", email: "kelechi.i@firstbank.com" },
  { first: "Aisha", last: "Lawan", email: "aisha.lawan@accessbank.com" },
  { first: "Obinna", last: "Eze", email: "obinna.eze@uba.com" },
  { first: "Folake", last: "Oyetola", email: "folake.oyetola@wemabank.com" },
  { first: "Ibrahim", last: "Idris", email: "ibrahim.idris@ecobank.com" },
  { first: "Chiamaka", last: "Nnadi", email: "chiamaka.nnadi@fidelity.com" },
  { first: "Damilola", last: "Ogunlesi", email: "damilola.ogunlesi@stanbic.com" },
  { first: "Hauwa", last: "Suleiman", email: "hauwa.suleiman@sterlingbank.com" },
  { first: "Chukwuemeka", last: "Nnamdi", email: "chukwuemeka.n@unionbank.com" },
];

const MERCHANT_BUSINESSES = [
  { name: "Jumia Nigeria Ltd", type: "ecommerce" as const, website: "https://jumia.com.ng" },
  { name: "Konga Online Shopping", type: "ecommerce" as const, website: "https://konga.com" },
  { name: "Kobo360 Logistics", type: "saas" as const, website: "https://kobo360.com" },
  { name: "Paystack Merchants", type: "marketplace" as const, website: "https://paystack.com" },
  { name: "Flutterwave Store", type: "ecommerce" as const, website: "https://store.flutterwave.com" },
  { name: "PiggyVest Savings", type: "saas" as const, website: "https://piggyvest.com" },
  { name: "Cowrywise Investments", type: "saas" as const, website: "https://cowrywise.com" },
  { name: "Farmcrowdy Agriculture", type: "marketplace" as const, website: "https://farmcrowdy.com" },
  { name: "Andela Tech Training", type: "saas" as const, website: "https://andela.com" },
  { name: "Bolt Nigeria Rides", type: "marketplace" as const, website: "https://bolt.eu/ng" },
];

const BANKS = [
  { code: "044", name: "Access Bank" },
  { code: "058", name: "GTBank" },
  { code: "057", name: "Zenith Bank" },
  { code: "011", name: "First Bank" },
  { code: "033", name: "UBA" },
  { code: "215", name: "Unity Bank" },
  { code: "035", name: "Wema Bank" },
  { code: "050", name: "Ecobank" },
  { code: "232", name: "Sterling Bank" },
  { code: "032", name: "Union Bank" },
];

const PROVIDERS = ["paystack", "flutterwave", "nibss", "interswitch", "mono"];
const CURRENCIES = ["NGN"];
const CORRIDORS = ["NG-NG", "NG-GH", "NG-KE", "NG-ZA", "NG-GB", "NG-US"];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomAmount(): number {
  const amounts = [5000, 10000, 25000, 50000, 75000, 100000, 150000, 250000, 500000, 1000000, 2500000];
  return randomItem(amounts);
}

function randomDate(daysBack: number): Date {
  const now = new Date();
  const past = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
  return new Date(past.getTime() + Math.random() * (now.getTime() - past.getTime()));
}

function generateApiKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "demo_pk_";
  for (let i = 0; i < 32; i++) key += chars[randomInt(0, chars.length - 1)];
  return key;
}

function generateSecret(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "demo_sk_";
  for (let i = 0; i < 32; i++) key += chars[randomInt(0, chars.length - 1)];
  return key;
}

function generateSessionId(): string {
  return `sess_${Date.now()}_${randomInt(1000, 9999)}`;
}

function generateRef(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomInt(100000, 999999)}`;
}

// ── Main Seed Function ─────────────────────────────────────────────────

async function seed() {
  console.log("🌱 Starting seed...");
  console.log(`   Database: ${DATABASE_URL.replace(/\/\/.*@/, "//***@")}`);

  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool, { schema });

  try {
    // 1. Users (20 users: 1 admin, 5 merchants, 2 participants, 2 CBN, 10 regular)
    console.log("   → Seeding users...");
    const userValues = NIGERIAN_NAMES.map((n, i) => ({
      username: `${n.first.toLowerCase()}.${n.last.toLowerCase()}`,
      password: "$2b$12$LJ3Y5h0NJqh5Kq8Gk3xOaOqK9n3nM8XvL2YwR7pJkF9mW4tN6dSi", // bcrypt hash of "SecurePass123!"
      email: n.email,
      firstName: n.first,
      lastName: n.last,
      role: i === 0 ? "admin" as const : i < 6 ? "merchant" as const : i < 8 ? "participant" as const : i < 10 ? "cbn" as const : "user" as const,
      twoFactorEnabled: i < 5 ? "true" as const : "false" as const,
    }));
    await db.insert(schema.users).values(userValues).onConflictDoNothing();

    // 2. Merchants (10 merchant accounts)
    console.log("   → Seeding merchants...");
    const merchantValues = MERCHANT_BUSINESSES.map((biz, i) => ({
      userId: i + 1,
      businessName: biz.name,
      businessType: biz.type,
      website: biz.website,
      apiKey: generateApiKey(),
      apiSecret: generateSecret(),
      webhookUrl: `${biz.website}/webhooks/payments`,
      webhookSecret: `whsec_${generateSecret().slice(8)}`,
      status: "active" as const,
      brandingPrimaryColor: ["#2563eb", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"][i % 5],
      brandingSecondaryColor: "#1e40af",
      brandingBackgroundColor: "#ffffff",
      brandingTextColor: "#1f2937",
      brandingFontFamily: "Inter",
      brandingBorderRadius: "8px",
    }));
    await db.insert(schema.merchants).values(merchantValues).onConflictDoNothing();

    // 3. Payment Sessions (200 sessions)
    console.log("   → Seeding payment sessions...");
    const sessionStatuses = ["completed", "pending", "processing", "failed", "cancelled"] as const;
    const sessionValues = Array.from({ length: 200 }, (_, i) => ({
      sessionId: generateSessionId() + i,
      merchantId: randomInt(1, 10),
      amount: String(randomAmount()),
      currency: "NGN",
      status: randomItem(sessionStatuses),
      successUrl: `https://shop.ng/success?ref=${i}`,
      cancelUrl: "https://shop.ng/cancel",
      customerEmail: randomItem(NIGERIAN_NAMES).email,
      metadata: JSON.stringify({ source: "web", userAgent: "Mozilla/5.0" }),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    }));
    await db.insert(schema.paymentSessions).values(sessionValues).onConflictDoNothing();

    // 4. Transactions (500 transactions)
    console.log("   → Seeding transactions...");
    const txnStatuses = ["pending", "authorized", "captured", "failed", "refunded"] as const;
    const paymentMethods = ["card", "bank_transfer", "qr_code", "wallet"] as const;
    const txnValues = Array.from({ length: 500 }, (_, i) => {
      const amount = randomAmount();
      return {
        sessionId: `sess_txn_${i}`,
        merchantId: randomInt(1, 10),
        amount: String(amount),
        currency: "NGN",
        status: randomItem(txnStatuses),
        paymentMethod: randomItem(paymentMethods),
        provider: randomItem(PROVIDERS),
        providerTransactionId: generateRef("PTX"),
        customerEmail: randomItem(NIGERIAN_NAMES).email,
        customerName: (() => { const n = randomItem(NIGERIAN_NAMES); return `${n.first} ${n.last}`; })(),
        feeAmount: String(Math.round(amount * 0.015)),
        netAmount: String(Math.round(amount * 0.985)),
        metadata: JSON.stringify({ ip: `102.89.${randomInt(1, 255)}.${randomInt(1, 255)}` }),
        fraudStatus: "approved" as const,
      };
    });
    await db.insert(schema.transactions).values(txnValues).onConflictDoNothing();

    // 5. Refunds (50 refunds)
    console.log("   → Seeding refunds...");
    const refundStatuses = ["pending", "processing", "completed", "failed"] as const;
    const refundValues = Array.from({ length: 50 }, (_, i) => ({
      transactionId: randomInt(1, 500),
      amount: String(randomAmount()),
      reason: randomItem(["customer_request", "duplicate_charge", "item_not_received", "defective_product", "fraud"]),
      status: randomItem(refundStatuses),
      processedBy: randomItem(NIGERIAN_NAMES).email,
    }));
    await db.insert(schema.refunds).values(refundValues).onConflictDoNothing();

    // 6. Webhooks (20 webhook endpoints)
    console.log("   → Seeding webhooks...");
    const webhookValues = Array.from({ length: 20 }, (_, i) => ({
      merchantId: (i % 10) + 1,
      url: `https://merchant${(i % 10) + 1}.ng/webhooks`,
      secret: `whsec_${generateSecret().slice(8)}`,
      events: JSON.stringify(["payment.completed", "payment.failed", "refund.completed", "dispute.created"]),
      isActive: true,
    }));
    await db.insert(schema.webhooks).values(webhookValues).onConflictDoNothing();

    // 7. Webhook Logs (100 delivery logs)
    console.log("   → Seeding webhook logs...");
    const webhookLogStatuses = ["pending", "delivered", "failed"] as const;
    const webhookLogValues = Array.from({ length: 100 }, (_, i) => ({
      webhookId: (i % 20) + 1,
      event: randomItem(["payment.completed", "payment.failed", "refund.completed"]),
      payload: JSON.stringify({ transactionId: `txn_${randomInt(1, 500)}`, amount: randomAmount() }),
      status: randomItem(webhookLogStatuses),
      responseCode: randomItem([200, 200, 200, 500, 404]),
      attempts: randomInt(1, 3),
    }));
    await db.insert(schema.webhookLogs).values(webhookLogValues).onConflictDoNothing();

    // 8. Audit Logs (200 audit entries)
    console.log("   → Seeding audit logs...");
    const auditLogValues = Array.from({ length: 200 }, (_, i) => ({
      userId: randomInt(1, 20),
      action: randomItem(["login", "create_merchant", "process_payment", "approve_kyc", "update_settings", "view_report", "create_refund", "update_webhook"]),
      resourceType: randomItem(["user", "merchant", "transaction", "session", "webhook", "dispute"]),
      resourceId: String(randomInt(1, 500)),
      ipAddress: `102.89.${randomInt(1, 255)}.${randomInt(1, 255)}`,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0",
      status: randomItem(["success", "failure"] as const),
    }));
    await db.insert(schema.auditLogs).values(auditLogValues).onConflictDoNothing();

    // 9. Disputes (30 disputes)
    console.log("   → Seeding disputes...");
    const disputeStatuses = ["open", "under_review", "resolved", "escalated", "closed"] as const;
    const disputeReasons = ["unauthorized_transaction", "item_not_received", "duplicate_charge", "amount_discrepancy", "service_not_provided"];
    const disputeValues = Array.from({ length: 30 }, (_, i) => ({
      transactionId: randomInt(1, 500),
      merchantId: randomInt(1, 10),
      customerId: randomInt(1, 20),
      amount: String(randomAmount()),
      currency: "NGN",
      reason: randomItem(disputeReasons),
      status: randomItem(disputeStatuses),
      description: `Customer dispute regarding ${randomItem(["payment", "refund", "charge", "subscription"])} - ${randomItem(["requires investigation", "evidence submitted", "awaiting merchant response"])}`,
      dueDate: new Date(Date.now() + randomInt(7, 30) * 24 * 60 * 60 * 1000),
    }));
    await db.insert(schema.disputes).values(disputeValues).onConflictDoNothing();

    // 10. Dispute Evidence (45 evidence items)
    console.log("   → Seeding dispute evidence...");
    const evidenceValues = Array.from({ length: 45 }, (_, i) => ({
      disputeId: (i % 30) + 1,
      type: randomItem(["receipt", "correspondence", "delivery_proof", "screenshot", "bank_statement"]),
      description: `Evidence ${i + 1}: ${randomItem(["Transaction receipt", "Email correspondence", "Delivery confirmation", "Screenshot of error", "Bank statement showing debit"])}`,
      fileUrl: `https://storage.paymentswitch.ng/evidence/ev_${i + 1}.pdf`,
      uploadedBy: randomItem(NIGERIAN_NAMES).email,
    }));
    await db.insert(schema.disputeEvidence).values(evidenceValues).onConflictDoNothing();

    // 11. Switch Participants (15 financial institutions)
    console.log("   → Seeding switch participants...");
    const participantValues = BANKS.map((bank, i) => ({
      userId: i + 1,
      institutionName: bank.name,
      institutionCode: bank.code,
      institutionType: randomItem(["commercial_bank", "microfinance", "mobile_money"]),
      contactName: `${randomItem(NIGERIAN_NAMES).first} ${randomItem(NIGERIAN_NAMES).last}`,
      contactEmail: `operations@${bank.name.toLowerCase().replace(/\s+/g, "")}.com`,
      contactPhone: `+234${randomInt(700, 999)}${randomInt(1000000, 9999999)}`,
      status: "active" as const,
      tier: randomItem(["starter", "growth", "enterprise", "premium"] as const),
      technicalContactName: `${randomItem(NIGERIAN_NAMES).first} ${randomItem(NIGERIAN_NAMES).last}`,
      technicalContactEmail: `tech@${bank.name.toLowerCase().replace(/\s+/g, "")}.com`,
    }));
    await db.insert(schema.switchParticipants).values(participantValues).onConflictDoNothing();

    // 12. Outbound Transfers (100 cross-border remittances)
    console.log("   → Seeding outbound transfers...");
    const outboundStatuses = ["admitted", "compliance", "routing", "settlement", "completed", "failed"] as const;
    const outboundValues = Array.from({ length: 100 }, (_, i) => {
      const amount = randomAmount();
      const corridor = randomItem(CORRIDORS);
      const destCurrency = corridor.split("-")[1] === "NG" ? "NGN" : corridor.split("-")[1] === "GH" ? "GHS" : corridor.split("-")[1] === "KE" ? "KES" : corridor.split("-")[1] === "ZA" ? "ZAR" : corridor.split("-")[1] === "GB" ? "GBP" : "USD";
      return {
        participantId: randomInt(1, 10),
        transactionRef: generateRef("OBT"),
        senderName: (() => { const n = randomItem(NIGERIAN_NAMES); return `${n.first} ${n.last}`; })(),
        senderAccount: `${randomItem(BANKS).code}${randomInt(1000000000, 9999999999)}`,
        senderBank: randomItem(BANKS).name,
        recipientName: `${randomItem(["James", "Sarah", "Michael", "Grace", "Peter"])} ${randomItem(["Smith", "Williams", "Brown", "Davis", "Wilson"])}`,
        recipientAccount: `${randomInt(10000000, 99999999)}`,
        recipientBank: randomItem(["Barclays", "Standard Chartered", "HSBC", "Equity Bank", "KCB"]),
        recipientCountry: corridor.split("-")[1],
        amount: String(amount),
        sourceCurrency: "NGN",
        destinationCurrency: destCurrency,
        exchangeRate: String(corridor.split("-")[1] === "NG" ? 1 : randomInt(50, 800) + Math.random()),
        fee: String(Math.round(amount * 0.005)),
        corridor,
        paymentRail: randomItem(["SWIFT", "PAPSS", "SEPA", "Mobile Money", "ACH"]),
        status: randomItem(outboundStatuses),
        purpose: randomItem(["family_support", "education", "business", "medical", "investment"]),
        complianceStatus: randomItem(["cleared", "pending", "flagged"]),
      };
    });
    await db.insert(schema.outboundTransfers).values(outboundValues).onConflictDoNothing();

    // 13. Rate Alerts (20 alerts)
    console.log("   → Seeding rate alerts...");
    const rateAlertValues = Array.from({ length: 20 }, (_, i) => ({
      userId: randomInt(1, 20),
      sourceCurrency: "NGN",
      targetCurrency: randomItem(["USD", "GBP", "EUR", "GHS", "KES"]),
      targetRate: String(randomInt(400, 1600) + Math.random()),
      condition: randomItem(["above", "below", "equals"]),
      isActive: i < 15,
    }));
    await db.insert(schema.rateAlerts).values(rateAlertValues).onConflictDoNothing();

    // 14. Compliance Documents (30 docs)
    console.log("   → Seeding compliance documents...");
    const complianceValues = Array.from({ length: 30 }, (_, i) => ({
      participantId: (i % 10) + 1,
      documentType: randomItem(["cac_certificate", "tax_clearance", "aml_policy", "board_resolution", "audited_financials", "directors_id"]),
      documentName: `Document_${i + 1}.pdf`,
      fileUrl: `https://storage.paymentswitch.ng/compliance/doc_${i + 1}.pdf`,
      status: randomItem(["pending", "approved", "rejected"]),
      reviewedBy: i % 3 === 0 ? randomItem(NIGERIAN_NAMES).email : null,
      expiresAt: new Date(Date.now() + randomInt(90, 365) * 24 * 60 * 60 * 1000),
    }));
    await db.insert(schema.complianceDocuments).values(complianceValues).onConflictDoNothing();

    // 15. Fee Configurations (10 fee rules)
    console.log("   → Seeding fee configurations...");
    const feeValues = Array.from({ length: 10 }, (_, i) => ({
      name: randomItem(["Card Processing Fee", "Bank Transfer Fee", "International Wire Fee", "USSD Fee", "QR Payment Fee", "Mobile Money Fee", "Settlement Fee", "Dispute Fee", "Refund Fee", "Platform Fee"]),
      type: randomItem(["percentage", "fixed", "tiered"]),
      value: String(randomItem([0.5, 1.0, 1.5, 2.0, 2.5, 25, 50, 100, 150, 500])),
      currency: "NGN",
      appliesTo: randomItem(["card", "bank_transfer", "all", "international", "domestic"]),
      isActive: true,
      minAmount: String(randomItem([0, 100, 1000])),
      maxAmount: String(randomItem([10000000, 50000000, 100000000])),
    }));
    await db.insert(schema.feeConfigurations).values(feeValues).onConflictDoNothing();

    // 16. Recurring Remittances (15 scheduled remittances)
    console.log("   → Seeding recurring remittances...");
    const recurringValues = Array.from({ length: 15 }, (_, i) => ({
      userId: randomInt(1, 20),
      recipientName: `${randomItem(["James", "Sarah", "Michael"])} ${randomItem(["Smith", "Williams", "Brown"])}`,
      recipientAccount: `${randomInt(10000000, 99999999)}`,
      recipientBank: randomItem(["Barclays", "Standard Chartered", "HSBC"]),
      recipientCountry: randomItem(["GH", "KE", "ZA", "GB", "US"]),
      amount: String(randomAmount()),
      sourceCurrency: "NGN",
      destinationCurrency: randomItem(["GHS", "KES", "ZAR", "GBP", "USD"]),
      frequency: randomItem(["weekly", "monthly", "quarterly"]),
      nextRunDate: new Date(Date.now() + randomInt(1, 30) * 24 * 60 * 60 * 1000),
      isActive: i < 12,
      purpose: randomItem(["family_support", "education", "rent", "business"]),
    }));
    await db.insert(schema.recurringRemittances).values(recurringValues).onConflictDoNothing();

    // 17. Batch Transfers (10 batch operations)
    console.log("   → Seeding batch transfers...");
    const batchValues = Array.from({ length: 10 }, (_, i) => ({
      userId: randomInt(1, 10),
      name: `Batch ${randomItem(["Salary", "Vendor", "Refund", "Bonus", "Commission"])} Payment - ${randomItem(["January", "February", "March", "April", "May", "June"])} 2026`,
      totalRecipients: randomInt(10, 200),
      totalAmount: String(randomInt(1000000, 50000000)),
      currency: "NGN",
      status: randomItem(["pending", "processing", "completed", "failed"]),
      processedCount: randomInt(0, 200),
      failedCount: randomInt(0, 5),
    }));
    await db.insert(schema.batchTransfers).values(batchValues).onConflictDoNothing();

    // 18. Support Tickets (25 tickets)
    console.log("   → Seeding support tickets...");
    const ticketValues = Array.from({ length: 25 }, (_, i) => ({
      userId: randomInt(1, 20),
      subject: randomItem([
        "Payment not received", "Transaction stuck in pending", "Webhook not delivering",
        "API rate limit exceeded", "KYC document rejected", "Settlement delay",
        "Chargeback dispute", "Account verification issue", "Integration help needed",
        "Refund not processed"
      ]),
      description: `Detailed description of the issue ${i + 1}. Customer reports ${randomItem(["payment failure", "delayed settlement", "incorrect amount", "missing transaction"])}. Requires immediate attention.`,
      priority: randomItem(["low", "medium", "high", "critical"]),
      status: randomItem(["open", "in_progress", "resolved", "closed"]),
      category: randomItem(["payments", "settlements", "disputes", "integration", "compliance", "account"]),
    }));
    await db.insert(schema.supportTickets).values(ticketValues).onConflictDoNothing();

    // 19. Notification Preferences (20 preference sets)
    console.log("   → Seeding notification preferences...");
    const notifPrefValues = Array.from({ length: 20 }, (_, i) => ({
      userId: i + 1,
      emailEnabled: true,
      smsEnabled: i < 10,
      pushEnabled: i < 15,
      paymentNotifications: true,
      settlementNotifications: i < 12,
      disputeNotifications: true,
      securityNotifications: true,
      marketingNotifications: i < 5,
    }));
    await db.insert(schema.notificationPreferences).values(notifPrefValues).onConflictDoNothing();

    // 20. Login History (100 login records)
    console.log("   → Seeding login history...");
    const loginValues = Array.from({ length: 100 }, (_, i) => ({
      userId: randomInt(1, 20),
      ipAddress: `102.89.${randomInt(1, 255)}.${randomInt(1, 255)}`,
      userAgent: randomItem([
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/17.4",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5) Mobile/15E148",
        "Mozilla/5.0 (Linux; Android 14) Chrome/125.0",
      ]),
      success: i % 7 !== 0,
      failureReason: i % 7 === 0 ? randomItem(["invalid_password", "account_locked", "2fa_failed"]) : null,
      location: randomItem(["Lagos, Nigeria", "Abuja, Nigeria", "Port Harcourt, Nigeria", "Kano, Nigeria", "Ibadan, Nigeria"]),
    }));
    await db.insert(schema.loginHistory).values(loginValues).onConflictDoNothing();

    // 21. Incident Reports (10 incidents)
    console.log("   → Seeding incident reports...");
    const incidentValues = Array.from({ length: 10 }, (_, i) => ({
      title: randomItem([
        "NIBSS NIP Gateway Timeout", "Paystack API 503 Error", "Settlement Batch Processing Delay",
        "Card Processing High Latency", "Webhook Delivery Queue Backup",
        "Database Connection Pool Exhaustion", "SSL Certificate Near Expiry",
        "Fraud Detection False Positives Spike", "Mobile Money Provider Downtime",
        "Rate Limiting Misconfiguration"
      ]),
      description: `Incident ${i + 1} details. Impact: ${randomItem(["partial service degradation", "full outage", "minor latency increase"])}. Root cause: ${randomItem(["provider issue", "infrastructure", "code deployment", "traffic spike"])}.`,
      type: randomItem(["outage", "degradation", "security", "other"] as const),
      severity: randomItem(["critical", "high", "medium", "low"] as const),
      status: randomItem(["open", "investigating", "resolved", "closed"] as const),
      reportedBy: randomItem(NIGERIAN_NAMES).email,
      assignedTo: randomItem(NIGERIAN_NAMES).email,
    }));
    await db.insert(schema.incidentReports).values(incidentValues).onConflictDoNothing();

    // 22. Production Monitoring (10 service monitors)
    console.log("   → Seeding production monitoring...");
    const monitorValues = Array.from({ length: 10 }, (_, i) => ({
      participantId: (i % 10) + 1,
      serviceName: randomItem(["Payment Gateway", "Settlement Engine", "Fraud Detection", "KYC Service", "Webhook Dispatcher", "Smart Router", "Card Processor", "NIBSS Connector", "Reconciliation Engine", "Rate Service"]),
      endpoint: `https://api.paymentswitch.ng/v1/${randomItem(["health", "status", "metrics"])}`,
      status: randomItem(["healthy", "degraded", "down"] as const),
      responseTimeMs: randomInt(10, 2000),
      lastChecked: new Date(),
      uptimePercentage: String(randomItem([99.99, 99.95, 99.9, 99.5, 98.0])),
    }));
    await db.insert(schema.productionMonitoring).values(monitorValues).onConflictDoNothing();

    // 23. Compliance Reports
    console.log("   → Seeding compliance reports...");
    const complianceReportValues = Array.from({ length: 10 }, (_, i) => ({
      participantId: (i % 10) + 1,
      reportType: randomItem(["quarterly_aml", "annual_audit", "suspicious_activity", "transaction_monitoring", "kyc_review"]),
      title: `${randomItem(["Q1", "Q2", "Q3", "Q4"])} 2026 ${randomItem(["AML Compliance", "Transaction Monitoring", "KYC Review", "Risk Assessment"])} Report`,
      status: randomItem(["draft", "submitted", "approved", "rejected"]),
      findings: JSON.stringify({ totalReviewed: randomInt(100, 10000), flagged: randomInt(0, 50), cleared: randomInt(50, 9000) }),
      submittedBy: randomItem(NIGERIAN_NAMES).email,
    }));
    await db.insert(schema.complianceReports).values(complianceReportValues).onConflictDoNothing();

    // 24. Security Events (50 events)
    console.log("   → Seeding security events...");
    const securityEventValues = Array.from({ length: 50 }, (_, i) => ({
      userId: randomInt(1, 20),
      eventType: randomItem(["login_attempt", "password_change", "2fa_enabled", "api_key_created", "suspicious_activity", "ip_blocked", "session_expired", "permission_change"]),
      severity: randomItem(["low", "medium", "high", "critical"]),
      ipAddress: `102.89.${randomInt(1, 255)}.${randomInt(1, 255)}`,
      userAgent: "Mozilla/5.0 Chrome/125.0",
      details: JSON.stringify({ action: randomItem(["success", "blocked", "flagged"]) }),
      resolved: i % 4 !== 0,
    }));
    await db.insert(schema.securityEvents).values(securityEventValues).onConflictDoNothing();

    // 25. Referrals (20 referrals)
    console.log("   → Seeding referrals...");
    const referralValues = Array.from({ length: 20 }, (_, i) => ({
      referrerId: randomInt(1, 10),
      referredEmail: `referred${i + 1}@${randomItem(["gmail.com", "yahoo.com", "outlook.com"])}`,
      referralCode: `REF${randomInt(100000, 999999)}`,
      status: randomItem(["pending", "registered", "active", "rewarded"]),
      rewardAmount: String(randomItem([1000, 2500, 5000, 10000])),
      rewardCurrency: "NGN",
    }));
    await db.insert(schema.referrals).values(referralValues).onConflictDoNothing();

    console.log("\n✅ Seed complete! Summary:");
    console.log("   • 20 users (admin, merchants, participants, CBN, regular)");
    console.log("   • 10 merchant accounts with API credentials");
    console.log("   • 200 payment sessions");
    console.log("   • 500 transactions across 5 payment methods");
    console.log("   • 50 refunds");
    console.log("   • 20 webhook endpoints + 100 delivery logs");
    console.log("   • 200 audit log entries");
    console.log("   • 30 disputes + 45 evidence items");
    console.log("   • 10 switch participants (banks)");
    console.log("   • 100 outbound cross-border transfers");
    console.log("   • 20 rate alerts");
    console.log("   • 30 compliance documents + 10 reports");
    console.log("   • 10 fee configurations");
    console.log("   • 15 recurring remittances + 10 batch transfers");
    console.log("   • 25 support tickets");
    console.log("   • 20 notification preferences");
    console.log("   • 100 login history records");
    console.log("   • 10 incident reports + 10 service monitors");
    console.log("   • 50 security events + 20 referrals");
    console.log("   Total: ~1,400+ rows across 25+ tables");
  } catch (error) {
    console.error("❌ Seed failed:", error);
    throw error;
  } finally {
    await pool.end();
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
