# Phase 1 — Foundation

**Status:** 🔲 Not started  
**Estimated duration:** 1–2 weeks  
**Goal:** A working ingestion pipeline that turns Plaid into a clean,
queryable Postgres dataset for one household.

Deliverable: Unified financial data platform. Everything in later
phases plugs into what this phase produces.

---

## Tasks

### 1. Repo scaffold
- Next.js 15 (App Router) + TypeScript + Tailwind + shadcn/ui
- Drizzle ORM + Drizzle Kit wired to Neon Postgres
- Inngest client configured
- Sentry initialized
- ESLint + Prettier + `prettier-plugin-tailwindcss`
- Vitest configured

### 2. Auth
- Clerk installed; all routes gated behind auth middleware
- `/api/auth/[...clerk]` handler
- `users` row created on first sign-in (webhook or middleware hook)

### 3. Schema + first migration
Define and migrate the Phase 1 tables (see Schema section below).
Run `drizzle-kit generate` + `drizzle-kit migrate`.

### 4. Plaid Link flow
- Install `plaid` Node SDK + `react-plaid-link`
- Client-side Link widget opens, exchanges public token
- `POST /api/plaid/exchange` → stores `plaid_items` + initial
  `accounts` fetch
- Encrypt access token at rest before persisting

### 5. Plaid webhook handler
- `POST /api/plaid/webhook` — verify `Plaid-Verification` signature
- On `TRANSACTIONS_SYNC_UPDATES_AVAILABLE` → enqueue Inngest event

### 6. Inngest sync functions
- `plaid/item.sync` — `transactions/sync` cursor loop (paginated);
  upsert added/modified, soft-delete removed; store updated cursor
- `plaid/balances.refresh` — cron daily; update account balances
- `plaid/investments.refresh` — cron daily (if investment product enabled)

### 7. Idempotent transaction upsert
- Key on `plaid_transaction_id`
- Handle `removed` array (set `deleted_at`)
- Do not create duplicates on retry

### 8. Manual CSV import (nice-to-have)
- Accept upload, map columns to normalized schema
- Feed through same upsert path as Plaid

### 9. Admin/debug UI
- `/admin/plaid` page: list items, institution, last sync, cursor
- Manual "re-sync" button → enqueue Inngest event
- Disconnect button → revoke Plaid token, soft-delete item + accounts

### 10. Audit log helper
- `packages/db/audit.ts` — typed `insertAuditEvent(...)` helper
- Call on every item connect/disconnect and manual data change

---

## Schema

```ts
// users
id: uuid PK
clerk_id: text UNIQUE
household_id: uuid
settings: jsonb  // { flags: {}, timezone: string, ... }
created_at / updated_at

// plaid_items
id: uuid PK
user_id: uuid FK users
access_token_enc: text  // encrypted
institution_id: text
institution_name: text
status: enum('active', 'disconnected', 'error')
cursor: text nullable  // transactions/sync cursor
last_synced_at: timestamptz
created_at / updated_at

// accounts
id: uuid PK
user_id: uuid FK users
plaid_item_id: uuid FK plaid_items
plaid_account_id: text UNIQUE
name: text
official_name: text nullable
mask: text nullable
type: text          // checking, savings, credit, investment, loan
subtype: text
currency: text DEFAULT 'USD'
balance_current: bigint  // cents
balance_available: bigint nullable
last_synced_at: timestamptz
deleted_at: timestamptz nullable
created_at / updated_at

// transactions
id: uuid PK
user_id: uuid FK users
account_id: uuid FK accounts
plaid_transaction_id: text UNIQUE nullable  // null for manual
posted_at: date
authorized_at: date nullable
amount_cents: bigint       // positive = debit, negative = credit
currency: text DEFAULT 'USD'
merchant_raw: text
merchant_normalized: text nullable
category: text nullable
category_source: enum('plaid','ai','user','rule') nullable
category_confidence: real nullable   // 0–1
pending: boolean DEFAULT false
source: enum('plaid','csv','manual') DEFAULT 'plaid'
confidence: real DEFAULT 1.0
deleted_at: timestamptz nullable
created_at / updated_at

// audit_events
id: uuid PK
actor: text         // clerk user id or 'system' or 'ai'
action: text        // 'plaid.connect', 'txn.tag', 'asset.update', ...
entity_type: text
entity_id: uuid
before: jsonb nullable
after: jsonb nullable
source: text        // 'user', 'ai', 'system', 'rule'
confidence: real nullable
at: timestamptz DEFAULT now()
```

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Plaid `transactions/sync` cursor complexity | Read the official guide end-to-end before coding. Store cursor per item, not globally |
| Sandbox → Production lead time | Apply for Production access on Day 1. Use Sandbox for dev |
| Access token security | Encrypt with `libsodium` or pgcrypto before insert; never log or select into response payloads |
| Duplicate transactions on retry | Upsert on `plaid_transaction_id`; test with a forced retry in Sandbox |

---

## Definition of Done

- [ ] Connect a Sandbox institution via Plaid Link; accounts appear in DB
- [ ] Transactions sync and populate `transactions` table
- [ ] Webhook → Inngest → sync triggered automatically
- [ ] Manual re-sync button works from admin page
- [ ] Disconnect removes item; no orphan data
- [ ] Idempotent: re-running sync produces no duplicates
- [ ] Plaid access token never appears in logs or API responses
- [ ] `audit_events` rows written for connect/disconnect

---

## First Week Day-by-Day

| Day | Focus |
|-----|-------|
| 1 | Repo scaffold (Next.js, Drizzle, Clerk, Neon, Inngest, Sentry, lint) |
| 2 | Phase 1 schema + migration; Plaid Link + token exchange |
| 3 | Inngest `transactions/sync` cursor loop; idempotent upsert |
| 4 | Webhook handler; manual resync + disconnect UI |
| 5 | Audit log helper; admin debug page; test all flows in Sandbox |
| 6–7 | Seed fixtures; Playwright e2e for Link flow; stabilize |

By end of week 1: functioning ingestion + queryable data — the
foundation every later phase plugs into.
