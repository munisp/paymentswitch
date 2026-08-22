# Paymentswitch Compared with Mojaloop, UPI, CIPS, and Pix

**Date:** 22 August 2026  
**Author:** Manus AI  
**Scope:** Architecture, governance, clearing and settlement, identity, fraud and risk, interoperability, resilience, developer access, scale, openness, operating model, and production-readiness implications.

> **Executive conclusion:** Paymentswitch is best understood as a **cloud-agnostic payment orchestration and financial-services platform under hardening**, whereas Mojaloop, UPI, CIPS, and Pix are **payment-system or payment-scheme infrastructures with defined operators, participant rulebooks, access regimes, settlement arrangements, and live ecosystem responsibilities**. Paymentswitch currently has a broader application-service ambition than any one of the comparison systems, but it does not yet have their institutional operating model, regulated participant ecosystem, proven live scale, or externally validated transaction-finality regime.

This is an architectural and operational comparison, not a claim that the systems are direct substitutes. A platform can integrate with a payment system; it cannot become equivalent to a national or cross-border payment system merely by implementing similar APIs or deploying similar middleware.

## 1. Comparison framing

The five subjects occupy different layers of the payments stack.

| Subject | Primary category | Operator / governance | Typical users | Core value |
|---|---|---|---|---|
| **Paymentswitch** | Application and orchestration platform | Project/operator-defined; current repository combines Node, Go, Rust, and Python services | Merchants, participants, administrators, internal operations, downstream rails | Route, admit, orchestrate, screen, settle, reconcile, and expose payment capabilities across multiple services and rails |
| **Mojaloop** | Open-source interoperable payment-system reference implementation | Mojaloop Foundation maintains the public software/community; each deployment has a Hub Operator and scheme governance | DFSPs and payment-system participants in a market | Interoperable real-time credit-push clearing, participant lifecycle, transfers, quotes, accounts, settlements, and scheme operations |
| **UPI** | Regulated national retail payment system/scheme | NPCI operates under RBI oversight | Indian banks, PSPs, TPAPs, consumers, merchants | Interoperable account-to-account and merchant payments through apps, UPI IDs, QR, intent, requests, and mandates |
| **CIPS** | Regulated wholesale cross-border RMB FMI | CIPS Co., Ltd.; PBOC supervises and governs | Direct and indirect financial institutions | Cross-border RMB clearing and settlement with RTGS and DNS modes, plus PvP/DvP/CCP capabilities |
| **Pix** | Regulated national instant-payment scheme and central settlement infrastructure | Banco Central do Brasil (BCB) manages and operates the scheme’s operational infrastructure | Regulated financial/payment institutions, consumers, merchants, government, payment initiators | Universal 24/7 instant payments with central directory, standardized initiation, and settlement through SPI |

Mojaloop’s own reference architecture distinguishes core bounded contexts such as settlements, account lookup and discovery, accounts and balances, transfers and transactions, quoting, participant lifecycle, scheduling, reporting/auditing, and cross-cutting identity and cryptography concerns.[1] Paymentswitch deliberately resembles this broad decomposition, but repository implementation breadth is not equivalent to a deployed scheme’s governance and operating responsibility.

## 2. High-level scorecard

The following scores assess **fit and maturity relative to the role of a production payment infrastructure**, not code quality alone. A score of 5 means the capability is defined, operated at ecosystem level, and supported by public or live evidence; 1 means it is mostly a repository capability or deployment assumption.

| Dimension | Paymentswitch | Mojaloop | UPI | CIPS | Pix |
|---|---:|---:|---:|---:|---:|
| Application-service breadth | **5** | 4 | 3 | 3 | 3 |
| Open-source / deployability | **5** | **5** | 2 | 2 | 2 |
| Defined operator and scheme governance | 2 | 4 | **5** | **5** | **5** |
| Participant onboarding and certification | 2 | 4 | **5** | **5** | **5** |
| Settlement model and legal-operational finality | 2 | 4 | 4 | **5** | **5** |
| Publicly evidenced production scale | 1 | 2 | **5** | 4 | **5** |
| Standardized interoperability | 3 | **5** | 5 | 4 | 4 |
| Identity, authorization, and message security | 3 | 4 | 4 | 4 | 4 |
| Fraud, dispute, and consumer protection regime | 2 | 3 | **5** | 4 | **5** |
| Resilience and recovery evidence | 2 | 4 | **5** | 4 | **5** |
| Cloud-agnostic self-hosting | **5** | 4 | 1 | 1 | 1 |
| **Overall role readiness** | **2.8** | **4.0** | **4.5** | **4.3** | **4.5** |

The scores are deliberately asymmetric. Paymentswitch scores highly as a flexible engineering platform, but low on institution-level evidence because its live APISIX, Keycloak, PostgreSQL, TigerBeetle, Redis, and Kubernetes gates remain unexecuted in the available environment. UPI, CIPS, and Pix score highly as operating systems because they have regulated operators, established participants, and published or operator-reported live metrics; their internal software openness is much lower.

## 3. Architectural comparison

### 3.1 Paymentswitch

The audited repository combines a Node.js application/API layer, Go ledger services, Rust FX and settlement services, Python compliance and AI services, PostgreSQL persistence, TigerBeetle ledger integration, Redis distributed resilience state, and infrastructure integrations including Keycloak, APISIX, OPA, Permify, Dapr, Temporal, Fluvio, and observability components. The current hardening work includes 128-bit TigerBeetle identifier migrations, collision quarantine, gRPC authorization, Redis-coordinated circuit breakers, retry deadlines, and fail-closed dependency behavior.[2]

Its strongest architectural advantage is **composability**. It can expose product-specific workflows—merchant payments, mobile money, onboarding, fraud review, remittance, settlement operations, administrative controls, and reporting—without requiring every capability to be part of a national scheme. It can also connect to several rails and providers.

Its main architectural weakness is **boundary ambiguity**. The repository contains both authoritative payment paths and legacy/seed-backed application surfaces. The application can therefore look more feature-complete than its actual live fund movement. The audit found and fixed several particularly dangerous examples: synthetic payment-orchestrator workflow responses, a legacy domestic endpoint that returned `COMPLETED` without a rail or ledger write, government/domestic seed-backed financial reads, and Redis idempotency fallback to process memory.[2]

### 3.2 Mojaloop

Mojaloop is closest to Paymentswitch conceptually, but at the **interoperable hub and scheme-platform layer** rather than at the product-suite layer. Its reference architecture defines bounded contexts for participant lifecycle, discovery, quoting, transfers, accounts and balances, settlements, scheduling, notifications, reporting, audit, identity, and cryptography.[1] Its FSPIOP API is an asynchronous participant-to-hub / participant-to-participant model with callbacks, transaction states, common identifiers, signatures, and operational workflows.[3]

Mojaloop does not itself constitute one universal payment operator. The Foundation maintains open-source software and community governance, while each national or regional deployment needs a Hub Operator, scheme rules, participant contracts, infrastructure, liquidity, settlement arrangements, security operations, support, and regulatory accountability.[4]

This makes Mojaloop a **strong architectural reference and integration target** for Paymentswitch. It is not a shortcut around scheme governance. Paymentswitch could use Mojaloop as its interoperability hub or connect its orchestration and ledger services to a Mojaloop Hub.

### 3.3 UPI

UPI is a **national retail system with controlled interoperability**, not an open-source self-hosted platform. NPCI operates it under RBI oversight. Its public participant model includes the UPI app, payer PSP, remitter bank, payee PSP, beneficiary bank, users, and merchants.[5]

The user-facing experience is deliberately abstracted from bank account details through UPI IDs, QR, intent, and request-money flows. NPCI describes 24/7 operation and two-factor authentication aligned with regulatory rules.[5] The customer transaction is presented as immediate, while participant-bank settlement is a separate regulated process with deferred-net characteristics and associated liquidity and reconciliation responsibilities.[6]

UPI’s architecture is optimized for **mass retail adoption, ecosystem interoperability, bank reach, and standardized user experience**. Paymentswitch is more flexible and broader in internal workflow capability, but it has no comparable regulated participant admission, certification, or user-scale evidence.

### 3.4 CIPS

CIPS is fundamentally different from Paymentswitch and UPI. It is a **wholesale cross-border RMB financial market infrastructure**. CIPS states that it operates as a critical FMI, with Phase I live in October 2015 and Phase II fully operational in May 2018.[7]

Its hybrid settlement model uses RTGS for individually initiated direct-participant transactions and DNS for bulk transactions. CIPS also supports cross-border RMB remittances, PvP, DvP, CCP settlement, and related transactions. Direct participants maintain zero-balance, non-interest-bearing, non-overdraft CIPS accounts, with liquidity arrangements connected to PBOC accounts and, where applicable, fund custodian banks.[7]

CIPS uses international standards and states that its message standards are based on ISO 20022 methodology.[7] Access is permissioned, with direct and indirect participation, technical acceptance, compliance, infrastructure, liquidity-risk, and security requirements. Paymentswitch should be viewed as a potential **participant-side orchestration, compliance, and integration layer** around CIPS—not as a peer to CIPS’s wholesale settlement infrastructure.

### 3.5 Pix

Pix is a **central-bank-managed national instant-payment scheme**. The BCB regulation establishes Pix, defines participation, requires certain large authorized institutions to participate, and provides for governance, non-discriminatory access, and the Pix Forum.[8]

The Pix architecture includes the DICT directory of transactional account identifiers and the SPI instant-payment settlement infrastructure. The BCB describes SPI as the centralized settlement infrastructure for instant payments between different payment service providers.[9] Pix’s regulation also incorporates manuals for initiation standards, security, communication interfaces, DICT operations, dispute resolution, sanctions, and service schedules.[8]

Pix therefore combines what Paymentswitch currently treats as separate concerns—scheme rules, participant access, identifier directory, standardized initiation, settlement infrastructure, operational manuals, and central-bank oversight—into a coherent national operating model.

## 4. Clearing and settlement comparison

| Topic | Paymentswitch | Mojaloop | UPI | CIPS | Pix |
|---|---|---|---|---|---|
| Primary settlement role | Internal/participant ledger and orchestration role; TigerBeetle plus PostgreSQL read models | Hub clearing, central ledger, settlement windows; immediate gross settlement can also be configured | Retail payment execution with participant-bank settlement under NPCI/RBI rules | Wholesale cross-border RMB RTGS and DNS, plus PvP/DvP/CCP | Central-bank instant-payment settlement through SPI |
| Settlement account model | Application-specific; must be defined per participant and currency | Scheme/deployment-specific liquidity and settlement accounts | Participant-bank and regulated settlement arrangements | CIPS/PBOC accounts, liquidity management, custodians | SPI/BCB settlement accounts and regulated participant arrangements |
| Finality | Must be established by system contract, TigerBeetle outcome, workflow state, and reconciliation | Documented scheme invariants and transfer states; finality depends on scheme rules and deployment | Regulated participant rules and failed-transaction/reversal frameworks | RTGS/DNS finality rules are defined in CIPS rules | Scheme regulation and SPI settlement rules |
| Netting | Platform-dependent | Central settlements can calculate net positions and windows | Deferred-net participant settlement | DNS for bulk; RTGS for individual direct-participant payments | Central instant settlement infrastructure |
| Multi-currency | Explicit platform ambition; Rust FX and settlement paths | Reference architecture supports multi-currency and multi-hop | Primarily domestic INR retail scope | Cross-border RMB, foreign-currency PvP capabilities | Primarily domestic BRL scope |
| Reconciliation | Application services and settlement read models | Central settlements, reports, audit, participant processes | NPCI/bank operational and dispute processes | CIPS messages, adjustment information, participant reconciliation | BCB/operator and participant processes |

The decisive difference is not whether each system has a “ledger.” It is **who legally and operationally owns the settlement obligation**. In Paymentswitch, that obligation is still architecture- and deployment-dependent. In CIPS and Pix, the central operator and regulatory framework define the settlement environment. In Mojaloop, the Hub Operator and scheme define it. In UPI, NPCI, RBI, and participating regulated institutions define it.

## 5. Identity, security, and trust boundaries

Paymentswitch uses Keycloak/JWKS validation, APISIX gateway controls, OPA policy, Permify relationships, gRPC authorization, mTLS/TLS, PostgreSQL role separation, and audit controls as intended architecture. The important limitation is evidence: live issuer configuration, JWKS rotation, certificate validation, spoofed-header rejection, APISIX route policy, and service-to-service authorization remain staging-gate requirements rather than sandbox-proven facts.[2]

Mojaloop’s published security model includes mutual X.509 TLS for participant-to-Hub links, OAuth 2.0, IP filtering, RBAC, JWS message protection, ILP cryptographic conditions, maker-checker controls, and audit logging.[10] Mojaloop is therefore stronger than a simple API gateway because it treats participant trust, message integrity, and scheme operations as first-class concerns.

UPI’s trust model is primarily regulated account-provider and user-device based. NPCI publicly describes UPI IDs, two-factor authentication, the UPI PIN, device/mobile linkage, complaints from the app, and non-disclosure of bank credentials to counterparties.[5] Its operational security is reinforced by RBI regulation, participant certification, transaction monitoring, and bank controls; the full central-switch security design is not public.

CIPS uses permissioned institutional participation, CIPS IDs/codes, BIC mapping, and LEI integration into digital certificates and relevant messages.[11] The system’s primary trust boundary is between regulated financial institutions and the CIPS/PBOC operating environment, rather than between mass-market end users and a retail app.

Pix is governed by BCB regulations and manuals covering communication, security, initiation, directory operation, dispute resolution, and sanctions.[8] Its model benefits from a central operator and mandatory/controlled participation, but participants still own their own customer authentication, fraud controls, endpoint security, and incident response.

## 6. Fraud, risk, disputes, and reversals

Paymentswitch has a hybrid fraud ambition: Python CPU-local AI, rule-based screening, compliance services, audit trails, and downstream authorization. That is strategically appropriate, but an AI score must never be treated as a ledger decision by itself. The production contract must specify which service can hold, reject, approve, release, reverse, or settle value, and all such transitions must be durable, idempotent, and auditable.

Mojaloop provides a scheme-wide Fraud and Risk Management Service model, transaction idempotency, liquidity and limit checks, signed messages, state controls, and auditability.[10] It provides the architecture for risk management but does not automatically provide a universal fraud model or liability regime.

UPI has the strongest consumer-facing operating regime among the compared systems: user authentication, participant controls, complaint channels, failed-transaction rules, reversal timelines, and NPCI/RBI governance.[5] [6] Its exact fraud scoring and internal loss-allocation models are not publicly complete.

CIPS focuses on institutional, AML, operational, liquidity, and business continuity risks. Its rules require participant risk management, early-warning mechanisms, emergency response, backup, and switchover exercises, but detailed fraud models and case-management logic are not public.[7]

Pix has a central-bank-defined scheme and manuals for dispute resolution and sanctions, plus evolving anti-fraud controls. Its operator model is better suited than an application-only platform to coordinate participant-wide fraud intelligence, blocking, and return-of-funds processes.

**Implication for Paymentswitch:** the platform should not market “fraud detection” as equivalent to a network fraud regime. It needs a formal risk-decision state machine with immutable evidence, explicit liability, hold/release authority, sanctions screening, velocity/limit controls, and tested return/reversal workflows.

## 7. Resilience and operational maturity

Paymentswitch has strong design intent in resilience: gRPC deadlines and jittered retries, circuit breakers with half-open limits, Redis distributed state, fail-closed dependency behavior, TigerBeetle transport framing validation, database collision quarantine, and explicit Stage 3/4 scripts. The remaining weakness is environmental evidence. Redis lease expiry and worker-death recovery have not been run against Redis; APISIX, Keycloak, TigerBeetle, PostgreSQL, and Kubernetes runtime gates have not produced a complete live evidence bundle.[2]

Mojaloop’s reference and deployment guidance treat redundancy, production HA, disaster recovery, operational monitoring, participant onboarding, and incident processes as deployment responsibilities. Its published performance work includes a demonstration of 1,000 clearing transfers per second on minimal hardware for one hour, with no more than 1% of transfer-stage processing above one second through the Hub; this is a Hub-stage demonstration, not an end-to-end scheme SLA.[12]

UPI operates at national retail scale and publishes operator statistics and incident/availability information. That scale reflects not only software capacity but a mature participant ecosystem, operating procedures, regulated incident handling, and bank-level redundancy.

CIPS runs on a published 5×24-hour plus four-hour schedule and requires backup systems, production-to-backup switchover drills, continuity, data integrity, and emergency mechanisms.[7] Its public materials do not disclose all site topology or recovery objectives.

Pix’s central-bank operation and SPI settlement infrastructure provide a stronger institutional continuity model than an application platform. The BCB’s role includes management and operation of the operational platforms, while participating institutions remain responsible for their own resilience and controls.[9]

## 8. Interoperability and developer access

| Dimension | Paymentswitch | Mojaloop | UPI | CIPS | Pix |
|---|---|---|---|---|---|
| External protocol posture | Project-defined APIs, REST/tRPC/gRPC, provider adapters | FSPIOP asynchronous APIs, callbacks, signatures, transaction states | Controlled NPCI participant interfaces and certification | ISO 20022-based message standards and controlled integration | Central-bank-defined manuals and communication interfaces |
| Access model | Operator/deployment-defined | Scheme and Hub Operator admission | Regulated NPCI participant admission | Permissioned direct/indirect participants | BCB-regulated participants and approved providers |
| Self-hosting | Yes, subject to infrastructure | Yes, open-source deployment | No | No | No |
| Inter-scheme role | Can be an adapter/orchestrator | Explicit inter-scheme and Hub reference architecture | Primarily national retail; cross-border links are separate arrangements | Cross-border RMB infrastructure | National rail; cross-border links are separate arrangements |
| Integration burden | High internal breadth; many services and dependencies | High, but SDKs and Payment Manager can reduce DFSP effort | High certification and regulated participant burden | Very high institutional/technical acceptance burden | High participant certification and regulated integration burden |

Paymentswitch’s open-source and cloud-agnostic posture is its main differentiator. Mojaloop is the closest open-source counterpart. UPI, CIPS, and Pix are not alternatives for a team seeking to self-host the national or wholesale system; they are regulated networks to which an institution integrates.

## 9. Scale and ecosystem evidence

The published numbers below are directional and **not comparable units**. UPI and Pix report live ecosystem activity; CIPS reports wholesale system activity; Mojaloop reports a controlled performance demonstration; Paymentswitch has no equivalent production-scale evidence in the audited repository.

| System | Evidence available | Interpretation |
|---|---|---|
| Paymentswitch | Local tests and static validators; no live Stage 3/4 dependency evidence | Engineering readiness evidence, not production transaction-scale evidence |
| Mojaloop | Published 1,000 Hub clearing transfers/sec demonstration for one hour | Reference-deployment performance baseline, excluding participant latency and not a universal SLA[12] |
| UPI | NPCI reported 23,658.35 million transactions and ₹29,87,880.49 crore value for July 2026, with 741 live banks on the accessed statistics page | Mature national retail ecosystem; operator-reported monthly snapshot[13] |
| CIPS | Operator reported 161 direct and 1,431 indirect participants in 118 countries/regions in November 2024; July 2026 services page reported 837,000 transactions totaling RMB 19.4 trillion | Mature wholesale cross-border network; operator-reported snapshot[7] |
| Pix | BCB reported nearly 170 million users and BRL 11 trillion in 2024 transactions in its five-year release | Mature national retail adoption; operator-reported annual snapshot[14] |

## 10. What Paymentswitch does better

Paymentswitch can be better than the comparison systems in areas that are not their primary mission. It can unify merchant onboarding, technical/security onboarding, remittance, domestic payments, mobile money, bill payments, fraud services, AI inference, participant operations, settlement workflows, and administrative dashboards in one product surface. It can deploy with open-source components across cloud or on-premise environments. It can also adapt to multiple rails, currencies, and deployment-specific business rules more quickly than a central national scheme.

Its Go/Rust/TigerBeetle focus can provide a strong technical foundation for high-throughput ledger and settlement workloads. Its Redis circuit-breaker improvements are more sophisticated than a simple local retry wrapper. Its PostgreSQL collision quarantine and immutable audit controls are appropriate responses to identifier and reconciliation risks.

## 11. What Paymentswitch does worse today

Paymentswitch is weaker than all four comparison systems in **institutional maturity**. It does not yet demonstrate a live participant ecosystem, formal scheme rulebook, regulated operator responsibility, production settlement finality, public availability history, certified onboarding, legally defined dispute liability, or nationally recognized consumer protection.

It is also weaker in **scope discipline**. Several legacy routers and services historically exposed seed-backed or in-memory financial state. Some have been remediated, but remaining surfaces must be classified before any production claim. A platform with many screens and endpoints can create more operational risk than a smaller rail if its displayed status, balance, or reconciliation is not authoritative.

Finally, Paymentswitch is weaker in **evidence**. The comparison systems’ published statistics are imperfect but demonstrate real ecosystems. Paymentswitch’s current evidence is primarily source inspection and local testing; real Redis, TigerBeetle, Keycloak, APISIX, PostgreSQL, and Kubernetes evidence remains outstanding.

## 12. Strategic positioning recommendation

Paymentswitch should not position itself as “another UPI,” “another Pix,” or a replacement for CIPS. It should position itself as a **participant-grade orchestration, compliance, ledger, settlement, and operations platform that can integrate with Mojaloop and regulated rails such as UPI, Pix, CIPS, domestic switches, mobile-money providers, and bank APIs**.

The strongest target architectures are:

| Target role | Strategic fit |
|---|---|
| Mojaloop Hub Operator or Hub-adjacent platform | Strong fit; Paymentswitch can add participant operations, onboarding, risk, AI, reconciliation, and product workflows around Mojaloop’s interoperability model. |
| Bank/PSP participant integration platform | Strong fit for UPI, Pix, CIPS, and domestic schemes; the platform becomes the participant’s internal orchestration, compliance, ledger, and reconciliation layer. |
| National scheme replacement | Weak fit today; requires legal mandate, central operator governance, participant rulebook, settlement accounts, certification, dispute regime, and live ecosystem. |
| Cross-border remittance and FX orchestration | Promising fit, but requires correspondent/rail contracts, sanctions controls, FX liquidity, corridor-specific rules, and settlement finality beyond application code. |
| Multi-rail treasury and settlement operations | Strong product opportunity if TigerBeetle, PostgreSQL read models, and reconciliation are proven under real failure and concurrency conditions. |

## 13. Required roadmap to close the gap

First, establish one authoritative payment state machine. Every transaction must have a durable lifecycle covering admitted, authorized, risk-held, submitted, accepted, processing, completed, failed, reversed, refunded, and reconciled states. No UI router may synthesize a completed state, and no downstream provider result may be accepted without durable correlation, idempotency, and reconciliation.

Second, complete the participant-grade integration contract. For Mojaloop, implement and test the FSPIOP participant boundary, callbacks, signatures, idempotency, party lookup, quoting, transfer, and settlement interactions. For UPI, Pix, CIPS, or domestic rails, treat the rail as a regulated external dependency with certification and operator-controlled access, not as a local mock.

Third, finish the infrastructure evidence. Run Stage 3/4 in isolated staging with real Redis, PostgreSQL, TigerBeetle, Keycloak, APISIX, OPA, Permify, and the required orchestrator. Produce evidence for worker death during half-open recovery, Redis restart, network partition, duplicate submissions, late provider responses, database lock contention, TigerBeetle outage/recovery, certificate rotation, invalid JWTs, spoofed headers, and reconciliation mismatches.

Fourth, replace the generic idempotency check-then-store design with an atomic reservation protocol. Use PostgreSQL `INSERT ... ON CONFLICT` or Redis `SET NX PX` with an owner token, request hash, in-flight state, and durable final response. The reservation must survive process crashes and prevent two workers from simultaneously initiating an external transfer.

Fifth, remove or explicitly isolate all remaining seed-backed financial surfaces. Test-only data should require a positive non-production flag and return a source marker that cannot be confused with production data. Production configuration should reject seed mode at startup.

Sixth, formalize institutional controls: participant eligibility, scheme rules, liquidity and prefunding, operator roles, maker-checker approvals, sanctions and fraud liability, dispute/reversal rules, incident response, RTO/RPO, audit retention, key ceremony, and external assurance. These are the main capabilities that separate Paymentswitch from UPI, Pix, CIPS, and a real Mojaloop deployment.

## Implementation completed in this repository pass

The repository now includes a canonical ISO 20022 profile module at `server/lib/iso20022.ts`. It validates core payment identity and amount fields, generates stable Message IDs, UETRs, instruction IDs, end-to-end IDs, transaction IDs, and correlation IDs, and serializes pacs.008.001.13, pacs.002.001.15, camt.056.001.10, and camt.029.001.14 messages. The real payment-orchestrator boundary now creates a pacs.008 message and carries its message ID, UETR, correlation ID, and XML payload in the orchestration metadata. This is a canonical-message foundation, not a claim of conformance to every scheme-specific ISO 20022 usage guideline.

Migration `drizzle/0049_iso20022_settlement_controls.sql` adds durable ISO message tracking, settlement obligations with numeric minor-unit amounts, 128-bit ledger identifiers, finality-certificate requirements, reconciliation exceptions, indexes, legal transition guards, and immutability protections for resolved exceptions. The new module has four deterministic tests, and the combined ISO/payment tests pass with 16 tests in that run; the earlier targeted resilience suite also passed with 25 tests.

The remaining implementation work is scheme-specific adapter certification: source/target BIC and clearing-member validation, full Business Application Header and Business Message Envelope conformance, market usage guidelines, XSD/Message Definition Report validation, signed transport, duplicate detection, inbound parser support, participant-specific settlement methods, and actual posting of settlement obligations to TigerBeetle within a transactionally reconciled workflow. The SQL migration still requires execution against staging PostgreSQL and review by the operator’s database owner before production use.

## Final assessment

Paymentswitch has the ingredients of a serious **participant and payment-orchestration platform**, and its open-source, cloud-agnostic design gives it an advantage over closed national or wholesale infrastructures for organizations that need control and customization. Mojaloop is the most relevant reference architecture and possible ecosystem integration target.

However, UPI, CIPS, and Pix are not merely software products. They are regulated, operated, certified, and institutionally accountable payment systems with live participants and settlement regimes. Paymentswitch is not yet comparable to them as a system of record or national/wholesale rail. It is comparable as a **building block that could power a participant, Hub Operator, PSP, or multi-rail financial platform**.

The defensible current conclusion is therefore: **strong platform architecture, incomplete scheme-level maturity, and not yet production-certified for independent systemically important fund movement.**

## References

[1]: https://docs.mojaloop.io/reference-architecture-doc/refarch/ "Mojaloop Reference Architecture Overview"
[2]: file:///home/ubuntu/paymentswitch-verify-main/audit/mission-critical-fund-flow-audit-2026-08-22.md "Paymentswitch Mission-Critical Fund-Flow Audit"
[3]: https://www.mojaloop.io/ "Mojaloop official project site and FSPIOP documentation hub"
[4]: https://mojaloop.io/now-introducingthe-mojaloop-foundation/ "Mojaloop Foundation governance announcement"
[5]: https://www.npci.org.in/product/upi/about-upi "NPCI About UPI"
[6]: https://www.rbi.org.in/Scripts/PublicationsView.aspx?id=21082 "Reserve Bank of India UPI discussion paper"
[7]: https://www.cips.com.cn/kjjqgsyyingw/jrcips/index.shtml "CIPS official Know CIPS and integration page"
[8]: https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Pix_Regulation/Resolution_BCB_1.pdf "Banco Central do Brasil Resolution BCB 1 and Pix Regulation"
[9]: https://www.bcb.gov.br/en/financialstability/spi_en "Banco Central do Brasil Instant Payment System (SPI)"
[10]: https://docs.mojaloop.io/community/tools/cybersecurity.html "Mojaloop cybersecurity guidance"
[11]: https://www.cips.com.cn/kjjqgsyyingw/gsdt/2021-10-29/124.html "CIPS LEI and digital certificate integration information"
[12]: https://docs.mojaloop.io/product/features/performance.html "Mojaloop performance documentation"
[13]: https://www.npci.org.in/product/upi/product-statistics "NPCI UPI product statistics"
[14]: https://www.bcb.gov.br/en/pressdetail/2640/nota "Banco Central do Brasil Pix at five press release"
