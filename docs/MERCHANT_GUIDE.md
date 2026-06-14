# Merchant Role on the Payment Switch Platform

## What Is a Merchant?

A **merchant** is any business entity that integrates with the National Payment Switch to accept electronic payments from customers. Merchants embed the payment switch's checkout flow into their website, app, or POS system using the provided API keys (`apiKey` + `apiSecret`).

The platform acts as the payment intermediary: it collects customer funds via multiple payment rails (card, bank transfer, USSD, mobile money, QR pay), settles funds, deducts platform fees, and pays out the net amount to the merchant's designated bank account.

## Merchant Lifecycle

1. **Registration** — Merchant creates an account via the Dashboard or API, providing business details (name, type, website).
2. **KYC/KYB Verification** — The platform verifies the merchant's identity, business registration (CAC in Nigeria), and compliance status. Status moves through: `pending_review` → `approved` or `rejected`.
3. **Integration** — Merchant receives API credentials (`pk_live_*` / `sk_live_*`), configures webhook URL and secret, and integrates the checkout SDK.
4. **Live Transactions** — Customers pay via the merchant's checkout. Each payment creates a `payment_session` and, upon completion, a `transaction` record.
5. **Settlement & Payout** — The settlement engine batches completed transactions, deducts fees, and initiates payout to the merchant's bank account.

## Example Merchants

### 1. E-Commerce Store — "JumiaNG Electronics"
- **Business Type**: `ecommerce`
- **Integration**: Embeds checkout widget on product pages
- **Payment Methods**: Card (Visa/Mastercard via Paystack), Bank Transfer (NIBSS NIP), USSD
- **Average Transaction**: ₦25,000 – ₦500,000
- **Settlement Cycle**: T+1 (next business day)

### 2. SaaS Platform — "Kobo360 Logistics"
- **Business Type**: `saas`
- **Integration**: Server-to-server API for recurring subscription billing
- **Payment Methods**: Card (auto-debit), Bank Transfer
- **Average Transaction**: ₦15,000/month per subscriber
- **Settlement Cycle**: Weekly batched

### 3. Marketplace — "Konga Marketplace"
- **Business Type**: `marketplace`
- **Integration**: Split payments — platform takes commission, sellers receive remainder
- **Payment Methods**: All rails (card, bank transfer, USSD, mobile money, QR)
- **Average Transaction**: ₦5,000 – ₦2,000,000
- **Settlement Cycle**: T+1 for platform, T+3 for sellers (held for dispute window)

## Payout Scenarios

### Scenario 1: Standard T+1 Payout (E-Commerce)

**Day 1 (Monday)**:
- Customer buys electronics for ₦150,000 via card
- Transaction status: `completed`
- Platform fee: 1.5% = ₦2,250

**Day 2 (Tuesday) — Settlement Window Closes**:
- Settlement engine creates batch for Monday's transactions
- Batch includes 47 transactions for JumiaNG, total gross: ₦3,200,000
- Platform fees deducted: ₦48,000
- **Net payout: ₦3,152,000** → transferred to merchant's GTBank account via NIBSS NIP

### Scenario 2: Dispute Hold (Chargeback)

**Day 1**: Customer pays ₦500,000 via Visa card
**Day 3**: Customer files chargeback — "item not received"
**Impact**: ₦500,000 is moved from merchant's pending settlement to dispute escrow
**Resolution**:
- If merchant wins (provides delivery proof): ₦500,000 released back to next settlement
- If merchant loses: ₦500,000 returned to customer + ₦5,000 chargeback fee debited from merchant

### Scenario 3: Weekly Batch Settlement (SaaS)

**Week of June 1–7**:
| Day | Subscriptions Collected | Amount |
|-----|------------------------|--------|
| Mon | 23 renewals | ₦345,000 |
| Tue | 18 renewals | ₦270,000 |
| Wed | 31 renewals | ₦465,000 |
| Thu | 12 renewals | ₦180,000 |
| Fri | 8 renewals | ₦120,000 |

**Friday EOD — Settlement**:
- Gross: ₦1,380,000
- Platform fees (1.2%): ₦16,560
- Failed payment reversals: ₦30,000
- **Net payout: ₦1,333,440** → transferred to merchant's Zenith Bank account

### Scenario 4: Marketplace Split Payment

**Transaction**: Customer buys ₦80,000 item from seller on Konga
- Platform commission: 8% = ₦6,400
- Payment processing fee: 1.5% = ₦1,200
- **Seller receives**: ₦80,000 - ₦6,400 - ₦1,200 = **₦72,400**
- **Platform receives**: ₦6,400 (commission) + portion of processing fee
- Seller payout: T+3 (3 business days, held for dispute window)
- Platform commission: Settled immediately to platform operating account

## Settlement Engine Flow

```
Customer Payment → Transaction Created (status: completed)
                           ↓
              Settlement Window Opens (configurable: T+1, T+3, weekly)
                           ↓
              Batch Created → Transactions aggregated per merchant
                           ↓
              Fee Deduction → Platform fees, processing fees, taxes
                           ↓
              Net Position Calculated → Gross - Fees = Net Payout
                           ↓
              Payout Initiated → Via NIBSS NIP / bank transfer
                           ↓
              Reconciliation → Provider confirmation matched
                           ↓
              Settlement Confirmed → Merchant notified via webhook
```

## Merchant Dashboard Tabs

| Tab | Purpose |
|-----|---------|
| Analytics | Revenue charts, transaction volume, success rates |
| Transactions | Real-time transaction list with status, payment method, amount |
| Sessions | Payment sessions (checkout links) — active, completed, expired |
| Settlements | Payout history — gross, fees, net; bank details; status |
| Disputes | Chargebacks — open/under_review/won/lost, evidence upload |
| Webhooks | Endpoint configuration, event subscriptions, delivery stats |
| Integration | API health — latency (p50/p95/p99), success rate, uptime |
| Team | Member management with roles (owner/admin/developer/finance/support) |
| Compliance | KYC/KYB/AML/PCI-DSS status, document verification |
| Financials | Revenue/fees/refunds/chargebacks breakdown, monthly trends |
| Notifications | Per-event email/SMS/push preferences |
| Branding | Checkout page customization — logo, colors, fonts |
