# Architecture

This document describes the system architecture of the AI Financial
Operating System. It is the canonical reference for *how* the system
is built. For *what* we are building and *why*, see
`docs/ROADMAP.md`. For stack rationale and per-phase build plans, see
`docs/STACK.md` and `docs/phases/`.

---

## 1. System Overview

A personal-first, chat-driven financial OS. The user interacts with a
conversational agent that has structured tools over a clean financial
data model. Dashboards are passive views of that same model.

```
External Sources       Ingestion          Storage           Intelligence         Surfaces
─────────────────      ─────────          ─────────         ───────────────      ────────────
Plaid                  Webhooks  ─┐                                              Dashboards (RSC)
Valuation APIs         Cron sync  ├──►  Postgres (Neon) ──►  Enrichment ──►  ┐   Chat (streaming)
Manual CSV / UI        CSV import ┘     + pgvector             Memory        ├─► Settings / Admin
                                                               Agent tools  ─┘
                                              ▲
                                              │
                                       Audit + Confidence
```

Core principles (from the roadmap):
- Dashboards display state. Chat drives intent.
- Manual overrides always win.
- Every AI-written field carries a `source` and a `confidence`.
- Reversibility: every write is auditable and undoable.

---

## 2. Architectural Layers

### 2.1 Ingestion Layer
- **Plaid** is the primary connector. Items, accounts, transactions,
  balances, investments, and liabilities are pulled via the official
  Node SDK.
- **Webhooks** trigger incremental sync via Inngest jobs. Polling
  (cron) acts as a backstop.
- **CSV import** reuses the same normalization + upsert path so
  manual data behaves identically to Plaid data.
- All ingestion writes are **idempotent** keyed on a stable external
  identifier (e.g. `plaid_transaction_id`).

### 2.2 Normalization Layer
- Raw payloads are mapped into the canonical schema in
  `packages/db/schema.ts`.
- Money is stored as `bigint` cents in a `currency`-aware column.
- Time is stored as UTC `timestamptz`; rendering converts to user TZ.
- Transactions track both raw merchant string (`merchant_raw`) and
  the normalized form (`merchant_normalized`).

### 2.3 Enrichment Layer
- **Merchant normalization**: deterministic rules table first, LLM
  fallback for unknowns, results cached.
- **Categorization**: rules → LLM fallback; user corrections create
  new rules and a memory entry.
- **Transfer detection**: heuristic pairing across accounts; linked
  pairs excluded from spending aggregates.
- **Recurring detection**: clustering by normalized merchant +
  cadence + amount band.
- Every enriched field stores `source ∈ {plaid, rule, ai, user}` and
  `confidence ∈ [0, 1]`.

### 2.4 Agent / Tool Layer
- Implemented with the **Vercel AI SDK**.
- Each tool is a typed TS function with a **Zod input schema**. The
  same Zod schema is fed to the model as the tool definition — one
  source of truth.
- Tools are grouped by responsibility:
  - **Read**: `get_accounts`, `get_assets`, `get_transactions`,
    `query_transactions`, `calculate_networth`,
    `summarize_period`, `forecast_cashflow`.
  - **Write (proposal)**: `update_asset`, `tag_transaction`,
    `create_rule_draft`, `create_budget`, `edit_budget`,
    `save_memory`.
- **Write tools never commit directly.** They produce a
  `pending_changes` row; the chat UI renders a diff card; on user
  approval, a server action commits and writes `audit_events`.
- A system prompt injects: current date, account summary, top
  relevant memories, household context, and guardrails (never
  invent numbers, always call tools for computation, no
  tax/legal/medical advice).

### 2.5 Memory Layer
- Stored in Postgres as `memories` rows with `pgvector` embeddings.
- Categories: `preference`, `household_rule`,
  `historical_context`, `goal`, `override_note`.
- Retrieval: top-K by cosine similarity, weighted by recency and
  confidence, capped (~10) before injection into the prompt.
- Memory content is **semantic**, not raw data — no amounts, no
  account numbers in embedded text.
- Auto-extraction proposes memories after each turn; user
  accepts/rejects via UI chip.

### 2.6 Surfaces
- **Dashboards** (Phase 2): Net Worth, Cash Flow, Asset, Debt.
  Built primarily as React Server Components reading typed queries
  from `packages/db`.
- **Chat** (Phase 3): streaming UI via `useChat`; tool calls render
  inline; write proposals render as approval cards.
- **Settings/Admin**: Plaid item management, memory management,
  rule management, export.

---

## 3. Data Model (Canonical Tables)

Not exhaustive — see `packages/db/schema.ts` for the source of
truth. Logical grouping:

**Identity & connections**
- `users(id, clerk_id, household_id, settings jsonb)`
- `plaid_items(id, user_id, access_token_enc, institution, status, cursor)`

**Accounts & transactions**
- `accounts(id, user_id, plaid_account_id, type, subtype, currency, balance_current, balance_available, last_synced_at)`
- `transactions(id, user_id, account_id, plaid_transaction_id, posted_at, amount_cents, currency, merchant_raw, merchant_normalized, category, category_source, category_confidence, pending, source, confidence, deleted_at)`

**Assets & liabilities**
- `assets(id, user_id, kind, name, value_cents, source, confidence, manual_override, metadata jsonb, updated_at)`
- `liabilities(id, user_id, account_id?, kind, balance_cents, apr, term_months, original_principal_cents, metadata jsonb)`
- `net_worth_snapshots(date, assets_cents, liabilities_cents, breakdown jsonb)`

**Enrichment**
- `merchant_aliases(raw_pattern, canonical, category_hint)`
- `categorization_rules(id, user_id, predicate jsonb, set_category, priority, created_by)`
- `transfer_links(out_txn_id, in_txn_id, confidence)`
- `recurring_series(merchant, cadence, expected_amount, next_expected_at, confidence)`

**Agent**
- `chat_sessions(id, user_id, title)`
- `chat_messages(id, session_id, role, content jsonb, tool_calls jsonb)`
- `pending_changes(id, user_id, kind, payload jsonb, status)`
- `memories(id, user_id, kind, text, embedding vector(1536), metadata jsonb, confidence, expires_at?)`
- `memory_proposals(...)`

**Planning**
- `goals(id, user_id, kind, target_amount, target_date, priority, constraints jsonb, status)`
- `budgets(id, user_id, period, category, cap_cents, goal_id?, manual_override)`
- `goal_progress(...)`

**Observability**
- `audit_events(id, actor, action, entity_type, entity_id, before jsonb, after jsonb, source, confidence, at)`

Conventions: `id` is `uuid`, all tables carry `created_at` /
`updated_at`, soft delete via `deleted_at` where deletion isn't
destructive.

---

## 4. Request & Job Flows

### 4.1 Plaid Sync
```
Plaid webhook ──► /api/plaid/webhook (verify sig) ──► Inngest event
                                                          │
                                                          ▼
                                              plaid.item.sync function
                                                          │
                                   ┌──────────────────────┼──────────────────────┐
                                   ▼                      ▼                      ▼
                       transactions/sync loop     balances refresh        investments refresh
                          (cursor-paginated)
                                   │
                                   ▼
                          idempotent upserts ──► enqueue enrichment
```

### 4.2 Chat Turn
```
User message
   │
   ▼
useChat (client) ──► /api/chat (server)
                         │
                         ▼
              build context: system prompt + recent msgs
              + retrieved memories + account summary
                         │
                         ▼
                  streamText(model, tools)
                         │
                ┌────────┴────────┐
                ▼                 ▼
          tool calls          assistant text
        (server-side)            (streamed)
                │
                ▼
   read tools: execute, return result
   write tools: insert pending_changes, return proposal
                │
                ▼
        stream tokens back to UI
```

### 4.3 Approval of a Write
```
User clicks Approve on proposal card
   │
   ▼
Server Action validates pending_changes row owned by user
   │
   ▼
Apply change inside a DB transaction
   │
   ▼
Insert audit_events row (before/after, source='ai-approved', actor=user)
   │
   ▼
Mark pending_changes.status = 'applied'
   │
   ▼
Revalidate affected RSC routes
```

---

## 5. Cross-Cutting Concerns

- **Money**: `bigint` cents; never `float`. Helpers in
  `packages/shared/money.ts`.
- **Time**: UTC `timestamptz` in DB; format in user TZ in UI.
- **Idempotency**: every external write keyed on stable upstream
  ID; every AI write keyed on `pending_changes.id`.
- **Confidence + source**: required columns on every enriched
  field.
- **Audit**: any mutation outside vanilla user data entry writes
  `audit_events`.
- **Secrets**: Plaid access tokens encrypted at rest (libsodium or
  `pgcrypto`); env vars never committed.
- **Privacy**: memory content is semantic; raw amounts/accounts
  never embedded.
- **Rate limiting**: Upstash Redis or Postgres bucket on chat
  endpoint and Plaid manual-resync.
- **Cost control**: log token usage per chat message;
  `gpt-4o-mini` for high-volume enrichment, Claude Sonnet only for
  reasoning/tool-heavy turns.
- **Feature flags**: `users.settings.flags` jsonb; no third-party
  flag service.

---

## 6. Tech Stack Summary

| Concern             | Choice                                     |
|---------------------|--------------------------------------------|
| App framework       | Next.js 15 (App Router) + React 19 + TS    |
| Styling             | Tailwind + shadcn/ui                       |
| Charts              | Recharts (or Tremor)                       |
| AI SDK              | Vercel AI SDK (`ai`, `@ai-sdk/react`)      |
| LLMs                | Claude Sonnet (primary), gpt-4o-mini (cheap), text-embedding-3-small |
| DB                  | Postgres on Neon                           |
| Vector              | pgvector extension                         |
| ORM                 | Drizzle + Drizzle Kit                      |
| Validation          | Zod (also drives tool schemas)             |
| Auth                | Clerk                                      |
| Jobs                | Inngest                                    |
| External            | Plaid                                      |
| Hosting             | Vercel                                     |
| Errors              | Sentry                                     |

See `docs/STACK.md` for rationale and alternatives.

---

## 7. Repo Layout

```
ledger/
  apps/web/                 # Next.js app (routes, components)
  packages/db/              # Drizzle schema, migrations, typed queries
  packages/ai/              # Tool registry, prompts, memory client
  packages/plaid/           # Plaid client + sync logic
  packages/shared/          # Zod schemas, money/date utils, types
  inngest/                  # Job definitions
  ARCHITECTURE.md
  AGENTS.md
  docs/
    ROADMAP.md
    STATUS.md
    STACK.md
    phases/
  README.md
```

Start as a single Next.js app; extract into a pnpm workspace at the
first sign of friction (expected around Phase 4).

---

## 8. Boundaries & Non-Goals

Explicitly out of scope for now:
- Multi-tenant orgs / enterprise RBAC (schema carries
  `household_id` so a later migration is mechanical).
- Mobile native app (PWA suffices).
- Tax optimization, retirement modeling, predictive trading,
  lot-level cost basis.
- Realtime streaming dashboards.

Revisit these only after Phase 6 stabilizes.
