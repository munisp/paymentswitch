# Guarded Legacy Seed-Branch Inventory

The earlier **36** figure was a narrow text scan. The repeatable branch inventory detects **61 explicit seed markers** across **42 distinct procedures**. All listed namespaces are blocked by `requireAuthoritativeRouter` unless a non-production environment explicitly sets `ENABLE_UNVERIFIED_DEMO_ROUTES=true`.

| Namespace | Procedure | Marker count | Source locations |
|---|---:|---:|---|
| `cardProcessing` | `<module-level legacy data>` | 1 | `server/routers/cardProcessingRouter.ts:8` — // --- Types & Seed Data --- |
| `cardProcessing` | `listCards` | 1 | `server/routers/cardProcessingRouter.ts:153` — _source: 'SEED' as const, |
| `cardProcessing` | `listChargebacks` | 1 | `server/routers/cardProcessingRouter.ts:245` — _source: 'SEED' as const, |
| `cardProcessing` | `listTerminals` | 1 | `server/routers/cardProcessingRouter.ts:253` — _source: 'SEED' as const, |
| `cardProcessing` | `listTransactions` | 1 | `server/routers/cardProcessingRouter.ts:208` — _source: 'SEED' as const, |
| `domesticPayments` | `<module-level legacy data>` | 12 | `server/routers/domesticPaymentsRouter.ts:32` — // --- Types & Seed Data ---<br>`server/routers/domesticPaymentsRouter.ts:124` — // NIBSS Gap Feature Types & Seed Data<br>`server/routers/domesticPaymentsRouter.ts:189` — // --- NEFT Seed Data ---<br>`server/routers/domesticPaymentsRouter.ts:197` — // --- NACS Cheque Seed Data ---<br>`server/routers/domesticPaymentsRouter.ts:205` — // --- NDD Mandate Seed Data ---<br>`server/routers/domesticPaymentsRouter.ts:214` — // --- Reversal Seed Data ---<br>`server/routers/domesticPaymentsRouter.ts:221` — // --- Dispute Seed Data ---<br>`server/routers/domesticPaymentsRouter.ts:229` — // --- Merchant Seed Data ---<br>`server/routers/domesticPaymentsRouter.ts:238` — // --- PayDirect Seed Data ---<br>`server/routers/domesticPaymentsRouter.ts:247` — // --- ISO 20022 Seed Data ---<br>`server/routers/domesticPaymentsRouter.ts:259` — // REMAINING 5% GAPS — Seed Data<br>`server/routers/domesticPaymentsRouter.ts:304` — // STAKEHOLDER ONBOARDING — Seed Data |
| `domesticPayments` | `getARTResults` | 1 | `server/routers/domesticPaymentsRouter.ts:1645` — _source: 'SEED DATA — ART service not running', |
| `domesticPayments` | `getGNNFraudNetworks` | 1 | `server/routers/domesticPaymentsRouter.ts:1760` — _source: 'SEED DATA — GNN service not running', |
| `domesticPayments` | `getMCMCFraudScoring` | 1 | `server/routers/domesticPaymentsRouter.ts:1916` — _source: 'SEED DATA — MCMC service not running', |
| `domesticPayments` | `getOllamaStatus` | 1 | `server/routers/domesticPaymentsRouter.ts:1542` — _source: 'SEED DATA — Ollama service not running', |
| `domesticPayments` | `getProphetPipeline` | 2 | `server/routers/domesticPaymentsRouter.ts:1329` — // Fallback to seed data if Python service is not available<br>`server/routers/domesticPaymentsRouter.ts:1380` — _source: 'SEED DATA — Python AI/ML service not running. Start with: cd payment-core/python-services && uvicorn nibss_analytics.real_ai_ml_service:app --port 8100', |
| `governmentPayments` | `<module-level legacy data>` | 1 | `server/routers/governmentPaymentsRouter.ts:8` — // --- Types & Seed Data --- |
| `governmentPayments` | `listGovernmentPayments` | 2 | `server/routers/governmentPaymentsRouter.ts:154` — // Fallback to seed data if DB unavailable or empty<br>`server/routers/governmentPaymentsRouter.ts:161` — _source: 'SEED' as const, |
| `governmentPayments` | `listPensions` | 1 | `server/routers/governmentPaymentsRouter.ts:231` — _source: 'SEED' as const, |
| `governmentPayments` | `listRegulatoryReports` | 1 | `server/routers/governmentPaymentsRouter.ts:265` — _source: 'SEED' as const, |
| `governmentPayments` | `listSocialDisbursements` | 1 | `server/routers/governmentPaymentsRouter.ts:257` — _source: 'SEED' as const, |
| `governmentPayments` | `listTaxPayments` | 1 | `server/routers/governmentPaymentsRouter.ts:201` — _source: 'SEED' as const, |
| `inboundRemittance` | `<module-level legacy data>` | 1 | `server/routers/inboundRemittanceRouter.ts:27` — // --- Seed Data --- |
| `inboundRemittance` | `getInboundARTResults` | 1 | `server/routers/inboundRemittanceRouter.ts:396` — _source: 'SEED DATA — Python AI/ML service not available (inbound remittance)', |
| `inboundRemittance` | `getInboundGNNFraudNetworks` | 1 | `server/routers/inboundRemittanceRouter.ts:421` — _source: 'SEED DATA — Python AI/ML service not available (inbound remittance)', |
| `inboundRemittance` | `getInboundMCMCFraudScoring` | 1 | `server/routers/inboundRemittanceRouter.ts:462` — _source: 'SEED DATA — Python AI/ML service not available (inbound remittance)', |
| `inboundRemittance` | `getInboundOllamaStatus` | 1 | `server/routers/inboundRemittanceRouter.ts:361` — _source: 'SEED DATA — Python AI/ML service not available (inbound remittance)', |
| `inboundRemittance` | `getInboundProphetPipeline` | 1 | `server/routers/inboundRemittanceRouter.ts:294` — _source: 'SEED DATA — Python AI/ML service not available (inbound remittance)', |
| `inboundRemittance` | `listTransfers` | 1 | `server/routers/inboundRemittanceRouter.ts:161` — // Fallback to seed data |
| `inboundRemittance` | `queryInboundOllama` | 1 | `server/routers/inboundRemittanceRouter.ts:375` — return { answer: `Analysis for inbound remittance query: "${input.question}" — This requires real-time Ollama LLM inference. Please ensure the Python AI/ML service is running on port 8101.`, latencyMs: 0, tokensGenerated: 0, _source: 'SEED' }; |
| `openBanking` | `<module-level legacy data>` | 1 | `server/routers/openBankingRouter.ts:8` — // --- Types & Seed Data --- |
| `openBanking` | `listConsents` | 1 | `server/routers/openBankingRouter.ts:189` — _source: 'SEED' as const, |
| `openBanking` | `listEndpoints` | 1 | `server/routers/openBankingRouter.ts:202` — _source: 'SEED' as const, |
| `openBanking` | `listSandboxes` | 1 | `server/routers/openBankingRouter.ts:207` — _source: 'SEED' as const, |
| `openBanking` | `listTPPs` | 1 | `server/routers/openBankingRouter.ts:139` — _source: 'SEED' as const, |
| `outboundRemittance` | `<module-level legacy data>` | 3 | `server/routers/outboundRemittanceRouter.ts:7` — * In dev mode (no DB), serves seed data. In production, queries PostgreSQL.<br>`server/routers/outboundRemittanceRouter.ts:64` — // Map userId to participantId (in seed data, participant.userId = user.id)<br>`server/routers/outboundRemittanceRouter.ts:77` — // When DB is unavailable, use seed data filtered by participant scope |
| `outboundRemittance` | `getOutboundARTResults` | 1 | `server/routers/outboundRemittanceRouter.ts:1424` — _source: 'SEED DATA — Python AI/ML service not available (outbound remittance)', |
| `outboundRemittance` | `getOutboundGNNFraudNetworks` | 1 | `server/routers/outboundRemittanceRouter.ts:1450` — _source: 'SEED DATA — Python AI/ML service not available (outbound remittance)', |
| `outboundRemittance` | `getOutboundMCMCFraudScoring` | 1 | `server/routers/outboundRemittanceRouter.ts:1495` — _source: 'SEED DATA — Python AI/ML service not available (outbound remittance)', |
| `outboundRemittance` | `getOutboundOllamaStatus` | 1 | `server/routers/outboundRemittanceRouter.ts:1389` — _source: 'SEED DATA — Python AI/ML service not available (outbound remittance)', |
| `outboundRemittance` | `getOutboundProphetPipeline` | 1 | `server/routers/outboundRemittanceRouter.ts:1322` — _source: 'SEED DATA — Python AI/ML service not available (outbound remittance)', |
| `outboundRemittance` | `queryOutboundOllama` | 1 | `server/routers/outboundRemittanceRouter.ts:1403` — return { answer: `Analysis for outbound remittance query: "${input.question}" — This requires real-time Ollama LLM inference. Please ensure the Python AI/ML service is running on port 8101.`, latencyMs: 0, tokensGenerated: 0, _source: 'SEED' }; |
| `outboundRemittance` | `reconcileAccount` | 5 | `server/routers/outboundRemittanceRouter.ts:1628` — // Payment Rails seed data — mirrors Go PaymentRailRegistry + MojaloopHubRouter<br>`server/routers/outboundRemittanceRouter.ts:1688` — // Enhancement seed data — approvals, audit, batches, netting, rate locks, etc.<br>`server/routers/outboundRemittanceRouter.ts:1767` — // Developer Portal seed data — API keys, SDKs, integration guide<br>`server/routers/outboundRemittanceRouter.ts:1800` — // Transaction Monitoring seed data — lifecycle tracking, search<br>`server/routers/outboundRemittanceRouter.ts:1869` — // Settlement Engine — Seed Data |
| `tradePayments` | `<module-level legacy data>` | 1 | `server/routers/tradePaymentsRouter.ts:8` — // --- Types & Seed Data --- |
| `tradePayments` | `listCustomsDuties` | 1 | `server/routers/tradePaymentsRouter.ts:188` — _source: 'SEED' as const, |
| `tradePayments` | `listEscrows` | 1 | `server/routers/tradePaymentsRouter.ts:163` — _source: 'SEED' as const, |
| `tradePayments` | `listLCs` | 1 | `server/routers/tradePaymentsRouter.ts:130` — _source: 'SEED' as const, |

## Central Guard Behavior

The guard runs after user authentication and Permify platform-view authorization for every `protectedProcedure`. It takes the first segment of the tRPC procedure path, compares it to the guarded namespace set, and throws `SERVICE_UNAVAILABLE` when that namespace has unverified data branches. The result is an explicit error instead of a seed payload.

```ts
const demoOverride = process.env.NODE_ENV !== 'production' &&
  process.env.ENABLE_UNVERIFIED_DEMO_ROUTES === 'true';
if (UNVERIFIED_DATA_ROUTER_NAMESPACES.has(namespace) && !demoOverride) {
  throw new TRPCError({ code: 'SERVICE_UNAVAILABLE', ... });
}
```
