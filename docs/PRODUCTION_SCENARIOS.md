# Production Scenarios & Workflows

## Stakeholders

| # | Stakeholder | Role |
|---|-------------|------|
| 1 | **Merchant** | Accepts payments, receives settlements |
| 2 | **Consumer/Sender** | Initiates payments and remittances |
| 3 | **CBN** (Central Bank of Nigeria) | Regulator — FX policy, corridor caps, reporting |
| 4 | **NFIU** (Nigerian Financial Intelligence Unit) | AML/CFT — STR filing, sanctions screening |
| 5 | **Participating Bank/DFSP** | Settlement counterparty, funds custodian |
| 6 | **Platform Operator** | NOC, system health, revenue management |
| 7 | **Compliance Officer** | KYC/KYB review, AML case management |
| 8 | **Developer/Integrator** | API integration, webhook consumption |

---

## Top 15 Production Scenarios

### Scenario 1: Outbound Remittance (NG → UK)
**Stakeholders**: Consumer, CBN, NFIU, Participating Bank
**Flow**:
1. Consumer initiates ₦5M transfer to UK beneficiary
2. KYC Tier 3 verification (BVN + NIN + liveness)
3. Sanctions screening (OFAC, UN, EU lists)
4. AML risk scoring (GNN model < 100ms)
5. CBN corridor cap check (NG-GB: max $5,000 PTA)
6. FX rate lock (CBN official + spread)
7. Corridor routing → SWIFT gpi or PAPSS
8. TigerBeetle debit sender, credit nostro
9. Settlement via NIBSS NIP to correspondent bank
10. Webhook notification to sender
11. CBN eFASS reporting (daily)
12. NFIU goAML STR if risk > threshold

### Scenario 2: Domestic P2P Transfer (NIP)
**Stakeholders**: Consumer, Participating Bank
**Flow**:
1. Sender initiates ₦50,000 transfer via mobile/PWA
2. BVN validation + PIN/biometric auth
3. Real-time fraud check (velocity, device fingerprint)
4. NIBSS NIP routing
5. TigerBeetle debit/credit in same batch
6. Instant settlement confirmation
7. Push notification to both parties

### Scenario 3: Merchant Payment Collection (Card)
**Stakeholders**: Merchant, Consumer
**Flow**:
1. Consumer pays ₦150,000 on merchant checkout
2. Card tokenization + 3DS authentication
3. Fraud scoring (real-time GNN)
4. Authorization via card processor
5. Transaction logged, session completed
6. Merchant webhook: `payment.completed`
7. T+1 settlement batch created
8. Fee deduction (1.5%) → net payout to merchant bank

### Scenario 4: Settlement Window Close (T+1)
**Stakeholders**: Merchant, Participating Bank, Platform Operator
**Flow**:
1. Settlement engine closes daily window (18:00 WAT)
2. Aggregate transactions per merchant per rail
3. Compute net positions (gross - fees - holds)
4. Generate settlement file (MT940/ISO20022)
5. Submit to NIBSS for interbank settlement
6. Reconcile confirmations against expected positions
7. Mark batches as settled/failed
8. Merchant webhook: `settlement.completed`
9. Exception queue for mismatches

### Scenario 5: Merchant Onboarding + KYB
**Stakeholders**: Merchant, Compliance Officer
**Flow**:
1. Merchant registers via dashboard or API
2. Business details submitted (CAC number, directors)
3. KYB verification (Ballerine client, document OCR)
4. Compliance officer reviews in admin portal
5. Multi-party approval (maker-checker)
6. Separation of duties enforced
7. API keys issued (pk_live_*, sk_live_*)
8. Webhook URL configured + test ping
9. Status: pending_review → approved

### Scenario 6: Chargeback / Dispute Resolution
**Stakeholders**: Consumer, Merchant, Compliance Officer
**Flow**:
1. Consumer files dispute (item not received)
2. Dispute created with SLA timer (24hr response)
3. Merchant notified via webhook: `dispute.created`
4. Funds moved to escrow (dispute hold)
5. Merchant uploads evidence (delivery proof)
6. Compliance officer reviews evidence
7. Decision: merchant wins → funds released to next settlement
8. Decision: consumer wins → refund + chargeback fee
9. Dispute event logged to audit trail

### Scenario 7: CBN Regulatory Reporting
**Stakeholders**: CBN, Platform Operator
**Flow**:
1. Daily eFASS report generated (all FX transactions)
2. Monthly corridor volume report
3. Quarterly compliance dashboard
4. Auto-suspend corridor if volume exceeds CBN cap
5. Real-time alerts for unusual FX patterns
6. 7-year record retention (BOFIA 2020)

### Scenario 8: NFIU Suspicious Transaction Report
**Stakeholders**: NFIU, Compliance Officer
**Flow**:
1. Transaction triggers AML threshold (₦5M+ cash, unusual pattern)
2. AML case auto-created with risk score
3. Graph analytics identifies linked entities (Neo4j)
4. Compliance officer investigates, adds evidence
5. SAR generated (goAML format)
6. Filed within 24 hours (MLPPA 2022 §7(1))
7. Case closed with decision + audit trail

### Scenario 9: POS Payment (Offline-capable)
**Stakeholders**: Merchant (Agent), Consumer
**Flow**:
1. Consumer taps card/scans QR at POS
2. POS terminal processes payment (online or store-and-forward)
3. Transaction synced when connectivity restored
4. Merchant account credited
5. Receipt generated (SMS + email)
6. Daily batch settlement for POS transactions

### Scenario 10: Batch Payroll Disbursement
**Stakeholders**: Corporate Client, Participating Bank
**Flow**:
1. Corporate uploads CSV/API batch (1,000+ recipients)
2. Batch validated (account numbers, amounts, duplicates)
3. Insufficient funds check against corporate account
4. Sequential/parallel disbursement via NIP
5. Per-recipient status tracking (success/failed/pending)
6. Failed payments auto-retried (exponential backoff)
7. Batch completion webhook + downloadable report

### Scenario 11: Recurring Remittance (Subscription)
**Stakeholders**: Consumer, CBN
**Flow**:
1. Consumer sets up monthly ₦200,000 transfer to family abroad
2. Standing instruction stored with mandate reference
3. Auto-debit on schedule date
4. CBN corridor cap check per transaction
5. If cap exceeded → hold and notify
6. Successful transfer → SMS/push notification
7. Failed → retry next day, escalate after 3 failures

### Scenario 12: Platform Operator NOC Dashboard
**Stakeholders**: Platform Operator
**Flow**:
1. Real-time system health (all 50+ microservices)
2. Transaction throughput gauges (TPS, latency P99)
3. Settlement batch progress (pending/in-flight/settled)
4. Kafka consumer lag monitoring
5. Alert on circuit breaker trips
6. Incident management (acknowledge, resolve, postmortem)
7. Kill switch for specific corridors/rails

### Scenario 13: Developer API Integration
**Stakeholders**: Developer/Integrator
**Flow**:
1. Sign up on developer portal
2. Create sandbox API keys
3. Explore API docs + code samples
4. Implement payment collection endpoint
5. Test webhooks via webhook simulator
6. Request production API keys (requires KYB approval)
7. Go live with rate limiting + monitoring

### Scenario 14: Inbound Remittance (UK → NG)
**Stakeholders**: Consumer (beneficiary), Participating Bank, CBN
**Flow**:
1. Correspondent bank sends SWIFT MT103
2. Platform receives and validates
3. Beneficiary KYC verified
4. CBN FX conversion at official rate
5. TigerBeetle credit beneficiary
6. NIP payout to beneficiary bank
7. SMS notification to beneficiary
8. CBN eFASS inbound report

### Scenario 15: Government Bulk Payment (Social Program)
**Stakeholders**: Government Agency, Participating Bank
**Flow**:
1. Government agency uploads beneficiary list
2. Identity validation (NIN/BVN match)
3. Bulk disbursement via NIP/mobile money
4. Real-time dashboard for disbursement progress
5. Reconciliation report generated
6. Audit trail for accountability
