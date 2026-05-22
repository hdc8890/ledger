# Phase 4 — AI Enrichment

**Status:** 🔲 Not started  
**Estimated duration:** 2 weeks  
**Depends on:** Phase 1 complete  
**Goal:** Drastically reduce manual categorization work and raise
transaction data quality through a tiered enrichment pipeline.

Deliverable: Reduced manual work. Most transactions auto-categorized
with high confidence. Transfer pairs excluded from spending. Recurring
bills detected.

---

## Tasks

### 1. Merchant normalization
- `merchant_aliases` table: `(raw_pattern, canonical, category_hint)`
- Deterministic rules checked first (exact + regex match)
- AI fallback for unknowns: single `gpt-4o-mini` call with
  structured JSON output schema; batch up to 50 unknowns per call
- Cache result keyed on normalized raw merchant string
- Populate canonical on `transactions.merchant_normalized`

### 2. Category inference
- Define taxonomy: start with Plaid's PFC hierarchy, simplify to
  ~25 leaf categories that match how you actually think about spending
- Two-tier classifier:
  1. Deterministic rules (`categorization_rules` table, priority-ordered)
  2. LLM fallback for low-confidence / no-match
- Persist `category`, `category_source`, `category_confidence` on
  each transaction

### 3. Transfer detection
- Candidate pair criteria: same user, opposite signs, |Δamount| < 1%,
  |Δdate| ≤ 3 days, different accounts
- Emit `transfer_links(out_txn_id, in_txn_id, confidence)`
- All aggregation queries join + exclude transfer-linked pairs from
  spending and income totals

### 4. Recurring bill detection
- Cluster transactions by: normalized merchant + amount band
  (±10%) + cadence (weekly / monthly / annual)
- Persist `recurring_series(merchant, cadence, expected_amount,
  next_expected_at, confidence)`
- Surface upcoming bills in dashboard and chat context

### 5. Historical backfill
- Inngest fan-out job: split existing unprocessed transactions into
  batches of 50 → enqueue enrichment sub-events
- Respect LLM rate limits (token-bucket in Inngest or explicit
  `sleep` between batches)
- Backfill is idempotent: skip rows with `category_source IS NOT NULL`
  unless `--force` flag

### 6. Correction UI
- Transaction row: show category chip + source indicator + confidence
- One-click category correction → creates `categorization_rules` row
  + triggers re-categorization of similar transactions
- "Why this category?" tooltip explains the source

### 7. Dashboard + query updates
- All cash flow, spending, and category queries now use
  `category_source` preference order: user > rule > ai > plaid
- Transfer-linked transactions excluded from all spend/income totals
- Category breakdown chart now reflects enriched categories

---

## Schema Additions

```ts
// merchant_aliases
id: uuid PK
raw_pattern: text       // exact string or /regex/
canonical: text
category_hint: text nullable
priority: int DEFAULT 0
created_by: enum('seed','user','ai')
created_at

// categorization_rules
id: uuid PK
user_id: uuid FK users nullable  // null = global seed rule
predicate: jsonb   // { merchant_contains: 'COSTCO', amount_gte: null, ... }
set_category: text
priority: int DEFAULT 0
created_by: enum('user','ai','seed')
created_at

// transfer_links
id: uuid PK
user_id: uuid FK users
out_txn_id: uuid FK transactions
in_txn_id: uuid FK transactions
confidence: real
created_at
UNIQUE (out_txn_id, in_txn_id)

// recurring_series
id: uuid PK
user_id: uuid FK users
merchant_normalized: text
cadence: enum('weekly','biweekly','monthly','quarterly','annual')
expected_amount_cents: bigint
amount_tolerance_pct: real DEFAULT 0.10
next_expected_at: date nullable
last_seen_at: date
confidence: real
created_at / updated_at
```

---

## Risks

| Risk | Mitigation |
|------|-----------|
| LLM cost during backfill | Batch 50 transactions per call; `gpt-4o-mini` for classification; estimate cost before running on full history |
| User corrections drift from AI suggestions | User-set `category_source='user'` always wins; never overwrite it |
| Transfer detection false positives | Require |Δamount| < 1% and different accounts; allow user to unlink false-positive pairs |
| Backfill timeouts | Fan out via Inngest; each batch is a separate event; retries are safe (idempotent) |

---

## Definition of Done

- [ ] New transactions auto-enriched within 2s of sync
- [ ] ≥ 80% of common merchants auto-categorized with `confidence ≥ 0.8`
- [ ] Transfer pairs no longer appear in spending totals
- [ ] Recurring bills detected for Netflix, utilities, mortgage, etc.
- [ ] One-click category correction works and persists as a rule
- [ ] Historical backfill job completes without duplicates or LLM errors
- [ ] Dashboards and chat tools use enriched categories
