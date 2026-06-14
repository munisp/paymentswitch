# Test Plan: Dashboard Fallback Data + In-Memory Persistence

## What Changed
- Dashboard.tsx: Added `DEMO_MERCHANT`, `DEMO_TRANSACTIONS`, `DEMO_SESSIONS` fallback constants
- Fallback pattern: `const merchants = liveMerchants?.length > 0 ? liveMerchants : [DEMO_MERCHANT]`
- Auto-select at line 260 ensures `selectedMerchant` is set, making `currentMerchant` truthy at line 347
- Previously: no backend → merchants empty → `currentMerchant` null → `{currentMerchant && (...)}` gate blocked all 12 tabs
- Now: fallback → merchants = [DEMO_MERCHANT] → auto-select → currentMerchant truthy → all tabs render

## Test 1: Merchant Dashboard 12 Tabs Render with Fallback Data (PRIMARY)

**Setup**: No tRPC backend running (only Vite dev server on port 5173)

**Steps**:
1. Navigate to `http://localhost:5173/dashboard`
2. Verify page title shows "Merchant Dashboard"
3. Verify merchant name "Paystack Nigeria Ltd" is visible (from DEMO_MERCHANT)
4. Verify API credentials section shows `demo_pk_abc123...` (from DEMO_MERCHANT.apiKey)
5. Verify 12 tab triggers are visible: Analytics, Transactions, Sessions, Settlements, Disputes, Webhooks, Integration, Team, Compliance, Financials, Notifications, Branding
6. Click "Transactions" tab — verify table shows 5 rows with demo data (TXN-20260605-001 through TXN-20260604-005)
7. Click "Sessions" tab — verify table shows 4 rows with customer names (Adewale Johnson, Ada Okafor, Tunde Bakare, Enterprise Buyer)
8. Click "Settlements" tab — verify settlement data renders (not blank)
9. Click "Disputes" tab — verify dispute cards/list renders
10. Click "Webhooks" tab — verify webhook configuration UI renders
11. Click "Notifications" tab — verify notification preferences render

**Pass criteria**:
- Title "Merchant Dashboard" visible
- Business name "Paystack Nigeria Ltd" displayed
- All 12 tab triggers visible and clickable
- Transactions tab shows table with 5 demo rows including "TXN-20260605-001"
- Sessions tab shows entries with "Adewale Johnson" customer name
- Settlements/Disputes/Webhooks/Notifications tabs render content (not blank/empty)

**Fail criteria**:
- Page shows blank/empty area where tabs should be (means currentMerchant is null — fallback broken)
- Any tab click produces a crash or white screen
- Transaction/Session tabs show empty tables (means demo data not wired)

## Test 2: Admin Dashboard Pages (Regression)

**Setup**: Admin dashboard on port 3002, login with demo/demo

**Steps**:
1. Navigate to `http://localhost:3002`
2. Login with username "demo", password "demo"
3. Navigate to Settlement Console page
4. Verify page renders without crash (proves mock→default rename didn't break imports)
5. Navigate to Disputes page
6. Verify page renders without crash

**Pass criteria**:
- Login succeeds
- Settlement Console page renders (heading visible, no crash)
- Disputes page renders (heading visible, no crash)

**Fail criteria**:
- Page shows React error boundary / white screen (means mock→default rename broke an import)
- Login fails (unrelated to changes)

## Test 3: Go Build + Tests (Shell-only, no recording needed)

Already verified before push:
- `go build ./...` — clean
- `go test -race ./...` — all pass, no data races

This test was already completed. Include results in report as evidence.
