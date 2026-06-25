/**
 * Drizzle ORM schema for payment domain tables.
 * Covers: government payments, inbound remittance, domestic payments,
 * card processing, open banking, and trade payments.
 */

import { pgTable, text, timestamp, decimal, integer, boolean, jsonb, serial } from "drizzle-orm/pg-core";

// --- Government Payments ---

export const governmentPayments = pgTable("government_payments", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // tax, customs, levy, license
  status: text("status").notNull().default("pending"),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  payerName: text("payer_name").notNull(),
  payerId: text("payer_id").notNull(),
  agency: text("agency").notNull(),
  reference: text("reference").notNull(),
  description: text("description"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const taxPayments = pgTable("tax_payments", {
  id: text("id").primaryKey(),
  taxpayerTin: text("taxpayer_tin").notNull(),
  taxpayerName: text("taxpayer_name").notNull(),
  taxType: text("tax_type").notNull(),
  period: text("period").notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  status: text("status").notNull().default("pending"),
  firsReference: text("firs_reference"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const pensionRemittances = pgTable("pension_remittances", {
  id: text("id").primaryKey(),
  employerName: text("employer_name").notNull(),
  employerRcNumber: text("employer_rc_number").notNull(),
  pfaName: text("pfa_name").notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  employeeCount: integer("employee_count").notNull().default(0),
  period: text("period").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const socialDisbursements = pgTable("social_disbursements", {
  id: text("id").primaryKey(),
  programName: text("program_name").notNull(),
  beneficiaryCount: integer("beneficiary_count").notNull(),
  totalAmount: decimal("total_amount", { precision: 20, scale: 4 }).notNull(),
  disbursedAmount: decimal("disbursed_amount", { precision: 20, scale: 4 }).notNull().default("0"),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --- Inbound Remittance ---

export const inboundTransfers = pgTable("inbound_transfers", {
  id: text("id").primaryKey(),
  senderName: text("sender_name").notNull(),
  senderCountry: text("sender_country").notNull(),
  recipientName: text("recipient_name").notNull(),
  recipientAccount: text("recipient_account").notNull(),
  recipientBank: text("recipient_bank").notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  currency: text("currency").notNull(),
  localAmount: decimal("local_amount", { precision: 20, scale: 4 }).notNull(),
  exchangeRate: decimal("exchange_rate", { precision: 12, scale: 6 }),
  corridor: text("corridor").notNull(),
  status: text("status").notNull().default("pending"),
  rail: text("rail"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const inboundCorridors = pgTable("inbound_corridors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceCountry: text("source_country").notNull(),
  sourceCurrency: text("source_currency").notNull(),
  volume24h: decimal("volume_24h", { precision: 20, scale: 4 }).notNull().default("0"),
  avgRate: decimal("avg_rate", { precision: 12, scale: 6 }),
  status: text("status").notNull().default("active"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// --- Domestic Payments ---

export const domesticPayments = pgTable("domestic_payments", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // NIP, NEFT, RTGS
  senderAccount: text("sender_account").notNull(),
  senderBank: text("sender_bank").notNull(),
  recipientAccount: text("recipient_account").notNull(),
  recipientBank: text("recipient_bank").notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  narration: text("narration"),
  reference: text("reference").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const standingOrders = pgTable("standing_orders", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  recipientAccount: text("recipient_account").notNull(),
  recipientBank: text("recipient_bank").notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  frequency: text("frequency").notNull(), // daily, weekly, monthly
  nextExecution: timestamp("next_execution"),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const bulkDisbursements = pgTable("bulk_disbursements", {
  id: text("id").primaryKey(),
  initiatorId: text("initiator_id").notNull(),
  totalAmount: decimal("total_amount", { precision: 20, scale: 4 }).notNull(),
  beneficiaryCount: integer("beneficiary_count").notNull(),
  processedCount: integer("processed_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --- Card Processing ---

export const issuedCards = pgTable("issued_cards", {
  id: text("id").primaryKey(),
  holderId: text("holder_id").notNull(),
  holderName: text("holder_name").notNull(),
  lastFour: text("last_four").notNull(),
  scheme: text("scheme").notNull(), // visa, mastercard, verve
  type: text("type").notNull(), // debit, credit, prepaid
  status: text("status").notNull().default("active"),
  expiryMonth: integer("expiry_month").notNull(),
  expiryYear: integer("expiry_year").notNull(),
  issuedAt: timestamp("issued_at").defaultNow().notNull(),
});

export const cardTransactions = pgTable("card_transactions", {
  id: text("id").primaryKey(),
  cardId: text("card_id").notNull(),
  merchantName: text("merchant_name").notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  type: text("type").notNull(), // purchase, withdrawal, refund
  status: text("status").notNull().default("pending"),
  authCode: text("auth_code"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const chargebacks = pgTable("chargebacks", {
  id: text("id").primaryKey(),
  transactionId: text("transaction_id").notNull(),
  cardId: text("card_id").notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

// --- Open Banking ---

export const tpps = pgTable("tpps", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  clientId: text("client_id").notNull(),
  status: text("status").notNull().default("active"),
  consentCount: integer("consent_count").notNull().default(0),
  apiCallsToday: integer("api_calls_today").notNull().default(0),
  registeredAt: timestamp("registered_at").defaultNow().notNull(),
});

export const consents = pgTable("consents", {
  id: text("id").primaryKey(),
  tppId: text("tpp_id").notNull(),
  accountId: text("account_id").notNull(),
  permissions: jsonb("permissions").notNull().default([]),
  status: text("status").notNull().default("active"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --- Trade Payments ---

export const lettersOfCredit = pgTable("letters_of_credit", {
  id: text("id").primaryKey(),
  applicantName: text("applicant_name").notNull(),
  beneficiaryName: text("beneficiary_name").notNull(),
  issuingBank: text("issuing_bank").notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull().default("draft"),
  expiryDate: timestamp("expiry_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const escrowPayments = pgTable("escrow_payments", {
  id: text("id").primaryKey(),
  buyerName: text("buyer_name").notNull(),
  sellerName: text("seller_name").notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  status: text("status").notNull().default("held"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  releasedAt: timestamp("released_at"),
});

export const customsDutyPayments = pgTable("customs_duty_payments", {
  id: text("id").primaryKey(),
  importerName: text("importer_name").notNull(),
  declarationNumber: text("declaration_number").notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  dutyType: text("duty_type").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  paidAt: timestamp("paid_at"),
});

// --- Bill Payments ---

export const billPayments = pgTable("bill_payments", {
  id: text("id").primaryKey(),
  remittanceId: text("remittance_id"),
  reference: text("reference").notNull(),
  providerId: text("provider_id").notNull(),
  categoryId: text("category_id").notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  fee: decimal("fee", { precision: 20, scale: 4 }).notNull().default("0"),
  status: text("status").notNull().default("pending"),
  token: text("token"),
  customerRef: text("customer_ref"),
  customerName: text("customer_name"),
  providerResponse: jsonb("provider_response"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// --- Mobile Money ---

export const mobileMoneyTransfers = pgTable("mobile_money_transfers", {
  id: text("id").primaryKey(),
  remittanceId: text("remittance_id"),
  reference: text("reference").notNull(),
  provider: text("provider").notNull(),
  recipientPhone: text("recipient_phone").notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  fee: decimal("fee", { precision: 20, scale: 4 }).notNull().default("0"),
  status: text("status").notNull().default("pending"),
  transactionId: text("transaction_id"),
  providerResponse: jsonb("provider_response"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// --- Agent Cash Collection ---

export const collectionCodes = pgTable("collection_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  remittanceId: text("remittance_id").notNull(),
  amount: decimal("amount", { precision: 20, scale: 4 }).notNull(),
  currency: text("currency").notNull().default("NGN"),
  recipientPhone: text("recipient_phone").notNull(),
  provider: text("provider").notNull(),
  qrCodeUrl: text("qr_code_url"),
  status: text("status").notNull().default("active"),
  collectedAt: timestamp("collected_at"),
  agentId: text("agent_id"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --- Stablecoin Conversions ---

export const stablecoinConversions = pgTable("stablecoin_conversions", {
  id: text("id").primaryKey(),
  chargeId: text("charge_id").notNull(),
  remittanceId: text("remittance_id"),
  conversionId: text("conversion_id").notNull(),
  cryptoAmount: decimal("crypto_amount", { precision: 20, scale: 8 }),
  cryptoCurrency: text("crypto_currency"),
  fiatAmount: decimal("fiat_amount", { precision: 20, scale: 4 }),
  fiatCurrency: text("fiat_currency").default("NGN"),
  exchangeRate: decimal("exchange_rate", { precision: 16, scale: 8 }),
  status: text("status").notNull().default("pending"),
  providerResponse: jsonb("provider_response"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// --- Remittance Workflows ---

export const remittanceWorkflows = pgTable("remittance_workflows", {
  id: text("id").primaryKey(),
  remittanceId: text("remittance_id").notNull(),
  currentStep: text("current_step").notNull().default("waiting_payment"),
  recipientPhone: text("recipient_phone"),
  fiatAmount: decimal("fiat_amount", { precision: 20, scale: 4 }),
  accountId: text("account_id"),
  bankAccountNumber: text("bank_account_number"),
  bankCode: text("bank_code"),
  transferReference: text("transfer_reference"),
  kycVerificationId: text("kyc_verification_id"),
  retryCount: integer("retry_count").notNull().default(0),
  error: text("error"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// --- AML/Sanctions Screening ---

export const amlScreeningResults = pgTable("aml_screening_results", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), // individual, business
  firstName: text("first_name"),
  lastName: text("last_name"),
  businessName: text("business_name"),
  dateOfBirth: text("date_of_birth"),
  nationality: text("nationality"),
  riskScore: decimal("risk_score", { precision: 5, scale: 2 }).notNull(),
  riskLevel: text("risk_level").notNull(), // low, medium, high
  screeningProvider: text("screening_provider").notNull(),
  matches: jsonb("matches").default([]),
  sanctionsPassed: boolean("sanctions_passed"),
  sanctionsMatches: jsonb("sanctions_matches").default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// --- Webhook Deliveries ---

export const webhookDeliveries = pgTable("webhook_deliveries", {
  id: serial("id").primaryKey(),
  webhookId: text("webhook_id").notNull(),
  remittanceId: text("remittance_id"),
  event: text("event").notNull(),
  url: text("url").notNull(),
  payload: jsonb("payload"),
  status: text("status").notNull().default("pending"),
  responseCode: integer("response_code"),
  responseBody: text("response_body"),
  attempts: integer("attempts").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at"),
});
