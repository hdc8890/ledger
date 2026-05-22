# Phase 2 — Dashboard MVP

**Status:** 🔲 Not started  
**Estimated duration:** 1 week  
**Depends on:** Phase 1 complete  
**Goal:** Four passive, read-only dashboards driven entirely by the
Phase 1 dataset. Dashboards display state — they don't drive intent.

Deliverable: Basic financial observability.

---

## Tasks

### 1. App shell + nav
- Persistent sidebar/nav: Dashboard, Chat (placeholder), Accounts,
  Assets, Settings
- Mobile-responsive layout (PWA-ready)
- Route-based loading states + skeleton components

### 2. Query layer (`packages/db/queries/`)
Typed Drizzle functions — no raw SQL in route handlers or components:
- `getNetWorthSeries(userId, range)` — daily snapshots for sparkline
- `getCashFlow(userId, month)` — income / spending / savings by category
- `getAssetBreakdown(userId)` — per-asset-kind totals
- `getDebtSummary(userId)` — per-liability balance + projected payoff

Use SQL window functions and CTEs. All return typed objects.

### 3. Net Worth dashboard
- Total NW card with delta vs last month
- Sparkline / trend chart (30d, 90d, 1y)
- Allocation donut (asset kinds)
- Debt-to-asset ratio chip
- Nightly Inngest job populates `net_worth_snapshots`

### 4. Cash Flow dashboard
- Income vs spending grouped bar chart by month
- Savings rate card
- Top-5 spending categories this month vs prior month
- Exclude transfer-linked transactions (heuristic flag, pending Phase 4 enrichment)

### 5. Asset dashboard
- Per-asset kind cards: home, vehicles, brokerage, cash, crypto, manual
- Value + 30d and 1y delta
- Manual override badge when `source = 'user'`
- Confidence chip when `confidence < 0.8`

### 6. Debt dashboard
- Per-liability row: name, balance, APR (if known), type
- Projected payoff line using simple amortization
- Total debt card + total monthly minimum

### 7. Polish
- Empty states for each dashboard (no Plaid connected, no assets added)
- Skeleton loaders for every async section
- Default to RSC for all reads; add `'use client'` only for interactive
  chart hover/zoom

---

## Schema Additions

```ts
// assets
id: uuid PK
user_id: uuid FK users
kind: enum('home','vehicle','brokerage','cash','crypto','manual')
name: text
value_cents: bigint
source: enum('plaid','api','user','ai')
confidence: real DEFAULT 1.0
manual_override: boolean DEFAULT false
metadata: jsonb   // { vin, mileage, address, zestimate_url, ... }
updated_at / created_at

// liabilities
id: uuid PK
user_id: uuid FK users
account_id: uuid FK accounts nullable  // linked Plaid account if known
kind: enum('mortgage','auto','personal','student','credit_card','other')
name: text
balance_cents: bigint
apr: real nullable
term_months: int nullable
original_principal_cents: bigint nullable
metadata: jsonb
updated_at / created_at

// net_worth_snapshots
id: uuid PK
user_id: uuid FK users
date: date
assets_cents: bigint
liabilities_cents: bigint
breakdown: jsonb   // { home: 450000_00, brokerage: 120000_00, ... }
created_at
UNIQUE (user_id, date)
```

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Transfer double-counting inflates cash flow | Add simple heuristic exclusion flag before Phase 4 enrichment arrives |
| Assets/liabilities are empty until user adds them | Good empty states + a prompt to add manual assets or connect Plaid accounts |
| Net worth snapshots miss days if job fails | Backfill logic in the Inngest function for gaps > 1 day |

---

## Definition of Done

- [ ] All four dashboards render with real Plaid data
- [ ] Dashboards refresh within ~30s after a Plaid sync
- [ ] Initial page load (cached RSC) < 1s
- [ ] Empty states shown correctly when no data exists
- [ ] Manual asset entry form works (add home, vehicle, manual asset)
- [ ] Net worth snapshot job runs nightly and backfills gaps
