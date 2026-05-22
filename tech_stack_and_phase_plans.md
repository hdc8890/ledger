# AI Financial OS — Tech Stack & Phase Build Plans

Companion to `ai_financial_operating_system_roadmap.md`. This document
recommends a concrete tech stack optimized for a personal-first,
chat-first, AI-tool-calling product, and breaks each roadmap phase into
buildable tasks.

---

## Guiding Principles (drive every stack choice)

1. **Single-developer velocity.** Favor managed services + boring,
   well-trodden tools over bespoke infra.
2. **Type safety end-to-end.** Schema → DB → API → UI in one language
   reduces bugs and review burden when there's no team.
3. **AI-native ergonomics.** Tool calling, streaming, and embeddings
   must be first-class — not bolted on.
4. **Personal-first, not multi-tenant-first.** Defer auth orgs, RBAC,
   billing. Build for one household; design schema with `user_id` so
   multi-tenant is a future migration, not a rewrite.
5. **Manual override always wins.** Every AI write must be reversible
   and attributable (source + confidence + timestamp + actor).

---

## Recommended Tech Stack

### Frontend
- **Next.js 15 (App Router) + React 19 + TypeScript** — server
  components for dashboards, streaming for chat.
- **Tailwind CSS + shadcn/ui** — fast, owned components.
- **TanStack Query** — server cache for non-RSC client data.
- **Recharts** (or **Tremor**) — financial charts; both work, Recharts
  is more flexible long-term.
- **Vercel AI SDK (`ai` + `@ai-sdk/react`)** — `useChat`,
  `streamText`, tool calling, multi-provider.

### Backend / API
- **Next.js Route Handlers + Server Actions** for the app API.
- **tRPC** (optional) if you want typed RPC instead of REST; skip if
  Server Actions + Route Handlers feel sufficient.
- **Zod** everywhere for runtime validation (and for AI tool schemas —
  same schema doubles as the LLM tool definition).

### Database & ORM
- **Postgres on Neon** (serverless, branching, generous free tier).
  Alternative: Supabase if you want auth + storage bundled.
- **Drizzle ORM** — TS-native, no codegen step, SQL-shaped. Better fit
  than Prisma for finance queries (windowed aggregations, CTEs).
- **pgvector** extension — embeddings for memory + semantic
  transaction search.
- **Database migrations** via Drizzle Kit.

### Auth
- **Clerk** (fastest for a personal app; social + email magic links;
  trivial Next.js integration) OR **Auth.js** if you want to avoid a
  vendor.

### AI Layer
- **Vercel AI SDK** as the orchestration surface — provider-agnostic
  tool calling.
- **Anthropic Claude Sonnet** as primary model for reasoning/tool use,
  **OpenAI `gpt-4o-mini`** for cheap classification/enrichment, and
  `text-embedding-3-small` for embeddings.
- **Tool layer**: plain TS functions registered with the AI SDK; each
  tool's input schema is a Zod schema shared with the API.
- **Memory**: Postgres + pgvector. Don't reach for Pinecone/Mem0 yet —
  a `memories` table with `embedding vector(1536)` and a `kind` enum
  handles Phase 5 cleanly.
- **LangGraph / LangChain**: skip for now. They add complexity without
  payoff at this scale. Revisit only if multi-step planning gets
  unwieldy.

### Background Jobs & Scheduling
- **Inngest** — durable, observable, great DX, free tier ample. Use
  for: Plaid initial backfill, nightly sync, enrichment fan-out,
  webhook handlers, scheduled re-categorization.
- Alternative: **Trigger.dev** (similar shape).

### External Integrations
- **Plaid** (official `plaid` Node SDK) — Link + Transactions Sync +
  Investments + Liabilities products.
- **Property valuation**: defer; start with manual + Zillow scrape is
  ToS-risky. Use a paid API (RentCast or HouseCanary) when Phase 2+
  needs it; until then, manual value + appreciation curve.
- **Vehicle valuation**: VINData / MarketCheck / Kelley Blue Book
  partner APIs. Until then, manual + linear depreciation model.

### Infra & Ops
- **Vercel** — app hosting.
- **Neon** — Postgres.
- **Inngest Cloud** — jobs.
- **Sentry** — error + perf.
- **PostHog** (optional) — product analytics; personal-first so low
  priority.
- **Doppler** or Vercel env vars — secrets. Plaid + LLM keys must not
  hit the repo.

### Repo Layout (proposed)
```
ledger/
  apps/web/                 # Next.js app
  packages/db/              # Drizzle schema + migrations + queries
  packages/ai/              # tool registry, prompts, memory client
  packages/plaid/           # Plaid client + sync logic
  packages/shared/          # zod schemas, types, money/date utils
  inngest/                  # job definitions
```
Start as a single Next.js app; extract to a pnpm workspace at the
first sign of pain (probably Phase 4).

### Why not the alternatives
- **FastAPI/Python backend**: splits the stack, costs you shared
  types, and the Python AI ecosystem advantage is small when Vercel
  AI SDK + Anthropic/OpenAI SDKs are excellent in TS.
- **Prisma**: works, but Drizzle's SQL transparency wins for
  finance-heavy queries.
- **Supabase end-to-end**: fine choice; pick it if you want RLS for
  free and don't mind PostgREST. Neon + Clerk + Drizzle gives more
  control.

---

## Cross-Cutting Concerns (build once, used by every phase)

These aren't a phase — they're foundations woven through Phase 1.

- **Money type**: store as `bigint` cents (or `numeric(19,4)`); never
  `float`. Add a `Money` helper in `packages/shared`.
- **Time**: store UTC `timestamptz`; render in user TZ.
- **Idempotency**: every Plaid sync, AI write, and import must be
  idempotent on a stable external key.
- **Audit log**: `audit_events` table — `(actor, action, entity,
  before, after, source, confidence, at)`. AI writes always emit.
- **Confidence + source**: every enrichment-produced field carries
  `source` ('plaid' | 'ai' | 'user' | 'rule') and `confidence` (0–1).
- **Feature flags**: a simple `flags` JSON in user settings is
  enough; don't pull in LaunchDarkly.

---

## Phase Build Plans

Each phase lists: **goal**, **task breakdown**, **schema additions**,
**risks**, **definition of done**.

---

### Phase 1 — Foundation (1–2 weeks)

**Goal:** A working ingestion pipeline that turns Plaid into a clean,
queryable Postgres dataset for one household.

**Tasks**
1. Scaffold Next.js app + Tailwind + shadcn + Drizzle + Neon.
2. Add Clerk auth; gate all routes; create `users` row on first
   sign-in.
3. Define Drizzle schema (see below) and run first migration.
4. Plaid Link flow: client-side Link → `/api/plaid/exchange` →
   persist `plaid_items` + `accounts`.
5. Implement `/api/plaid/webhook` (signed verify) → enqueue Inngest
   sync.
6. Inngest functions:
   - `plaid.item.sync` (transactions/sync cursor pattern, paginated)
   - `plaid.balances.refresh` (cron daily)
   - `plaid.investments.refresh` (cron daily)
7. Idempotent transaction upsert keyed on `plaid_transaction_id`;
   handle `removed` IDs.
8. Manual CSV import endpoint (Phase 1 nice-to-have): map columns →
   normalized rows; same upsert path.
9. Admin/debug page: list items, last sync, retry sync, disconnect.
10. Audit log table + write helper.

**Schema additions**
- `users(id, clerk_id, household_id, settings jsonb)`
- `plaid_items(id, user_id, access_token_enc, institution, status, cursor)`
- `accounts(id, user_id, plaid_account_id, name, mask, type, subtype, currency, balance_current, balance_available, last_synced_at)`
- `transactions(id, user_id, account_id, plaid_transaction_id, posted_at, amount_cents, currency, merchant_raw, merchant_normalized, category, pending, source, confidence, deleted_at)`
- `audit_events(...)`

**Risks**
- Plaid `transactions/sync` cursor handling — read their guide
  carefully; store cursor per item.
- Sandbox vs Development vs Production keys — start in Sandbox; you
  need to apply for Production access early (lead time ~days).
- Token storage: encrypt access tokens at rest (libsodium / pgcrypto).

**DoD**
- Connect a Sandbox institution, see real-shape transactions in
  Postgres, manual resync works, disconnect cleans up.

---

### Phase 2 — Dashboard MVP (1 week)

**Goal:** Four passive dashboards driven entirely by the Phase 1
dataset.

**Tasks**
1. App shell + nav (Dashboard, Chat, Accounts, Assets, Settings).
2. Query layer in `packages/db`: typed functions for
   `getNetWorthSeries`, `getCashFlow(month)`, `getAssetBreakdown`,
   `getDebtSummary`. Use SQL window functions and CTEs.
3. **Net Worth** dashboard:
   - total NW card, sparkline, allocation donut, debt-to-asset ratio.
   - daily snapshots table `net_worth_snapshots(date, assets_cents,
     liabilities_cents, breakdown jsonb)` populated by a nightly
     Inngest job.
4. **Cash Flow** dashboard: income vs spending bars by month, savings
   rate, top-5 categories.
5. **Asset** dashboard: per-asset cards with value + 30d/1y delta.
6. **Debt** dashboard: per-liability balance, APR if known, projected
   payoff line (simple amortization).
7. Empty states + skeleton loaders; everything an RSC where possible,
   with TanStack Query only for interactivity.

**Schema additions**
- `assets(id, user_id, kind, name, value_cents, source, confidence, manual_override boolean, metadata jsonb, updated_at)`
- `liabilities(id, user_id, account_id?, kind, balance_cents, apr, term_months, original_principal_cents, metadata jsonb)`
- `net_worth_snapshots(...)`

**Risks**
- Transfer double-counting inflates cash flow. Even before Phase 4,
  add a simple heuristic flag and exclude from totals.

**DoD**
- All four dashboards render real data, refresh after a sync, and
  load < 1s on cached data.

---

### Phase 3 — AI Chat MVP (1–2 weeks)

**Goal:** A chat interface that can answer questions and perform safe
edits via tools.

**Tasks**
1. `/chat` route using `useChat` + `streamText` (Vercel AI SDK).
2. Tool registry in `packages/ai/tools/`:
   - `get_accounts`, `get_assets`, `get_transactions(filter)`,
     `query_transactions(sql-ish DSL or structured filters)`,
     `calculate_networth(asOf?)`, `summarize_period(range)`.
   - Write tools (gated behind confirm UI): `update_asset`,
     `tag_transaction`, `create_rule_draft`.
3. Each tool = Zod input schema + handler + result schema. The Zod
   schema is fed to the model verbatim.
4. **Safety pattern**: write tools return a *proposed change* object;
   chat UI renders a diff card with Approve/Reject; on approve, a
   separate server action commits + writes `audit_events`.
5. System prompt with: current date, user's accounts list summary,
   household context placeholder, guardrails (no advice on
   tax/legal/medical; always cite numbers; never invent transactions).
6. Conversation persistence: `chat_sessions`, `chat_messages` with
   role/content/tool_calls/tool_results.
7. Token + cost logging per message.
8. Rate limit via Upstash Redis or a Postgres bucket.

**Schema additions**
- `chat_sessions(id, user_id, title, created_at)`
- `chat_messages(id, session_id, role, content jsonb, tool_calls jsonb, created_at)`
- `pending_changes(id, user_id, kind, payload jsonb, status, created_at)`

**Risks**
- Model hallucinates numbers if it tries to compute instead of
  calling tools. Mitigate with a strong system prompt: "Never compute
  totals yourself — call `calculate_*` tools."
- Costs spiral if every dashboard load embeds chat context. Keep
  chat opt-in per session.

**DoD**
- "How much did I spend on groceries in October?" returns a correct,
  cited number.
- "Set my Tesla's value to $48,000" produces a confirm card; on
  approve, asset updates with `source='user'` and audit row appears.

---

### Phase 4 — AI Enrichment (2 weeks)

**Goal:** Drastically reduce manual categorization work; raise
transaction data quality.

**Tasks**
1. **Merchant normalization**: rules-first table
   `merchant_aliases(raw_pattern, canonical, category_hint)`; AI
   fallback for unknowns using `gpt-4o-mini` with a fixed JSON
   schema; cache by normalized raw string.
2. **Category inference**:
   - Define your category taxonomy (start with Plaid's PFC, simplify
     to ~25 leaf categories).
   - Two-tier classifier: deterministic rules → LLM fallback for
     low-confidence.
   - Persist `category`, `category_source`, `category_confidence`.
3. **Transfer detection**:
   - Pair candidate: same user, opposite signs, |Δamount|<1%,
     |Δdate|≤3 days, different accounts.
   - Emit `transfer_links(out_txn_id, in_txn_id, confidence)`; exclude
     linked pairs from spending aggregates.
4. **Recurring bill detection**:
   - Cluster by normalized merchant + amount band + cadence
     (weekly/monthly/annual).
   - Persist `recurring_series(merchant, cadence, expected_amount,
     next_expected_at, confidence)`.
5. Backfill job that re-enriches historical transactions in batches
   via Inngest fan-out; respect rate limits.
6. UI: transaction row shows source/confidence; one-click "correct
   category" creates a `categorization_rules` row + retrains future.
7. Dashboards updated to use enriched categories and exclude
   transfers.

**Schema additions**
- `merchant_aliases(...)`
- `categorization_rules(id, user_id, predicate jsonb, set_category, priority, created_by)`
- `transfer_links(...)`
- `recurring_series(...)`

**Risks**
- LLM cost during backfill. Batch into chunks of ~50 transactions
  per call with a compact JSON list format.
- Drift between user corrections and AI suggestions. Always let
  user-set values win and downweight AI confidence accordingly.

**DoD**
- New transactions are auto-categorized in <2s with confidence ≥0.8
  on >80% of common merchants.
- Transfer pairs no longer appear as spending.

---

### Phase 5 — Memory Layer (1–2 weeks)

**Goal:** Agent personalization — preferences, household rules, and
override persistence that travel across sessions.

**Tasks**
1. `memories` table with `embedding vector(1536)` (pgvector), `kind`
   enum (`preference` | `household_rule` | `historical_context` |
   `goal` | `override_note`), `text`, `metadata jsonb`,
   `expires_at?`, `confidence`.
2. `save_memory` tool exposed to the agent; explicit `delete_memory`
   and `list_memories` for user control.
3. **Auto-extraction**: a post-turn job inspects the conversation
   and proposes new memories (LLM call with a strict JSON schema);
   user sees a subtle "Remember: X?" chip in chat to accept/reject.
4. **Retrieval**: before each chat turn, embed the user message,
   pull top-K relevant memories + recent overrides + key facts
   (account list, household members), inject into system prompt.
5. **Override persistence**: when a user corrects a category or
   asset value, store both the concrete write *and* a
   `household_rule` memory ("Costco → Groceries") so future
   categorization respects it without rerunning the LLM.
6. Memory management UI under Settings: list, edit, delete, export.
7. Privacy: never embed amounts or account numbers into memory text;
   keep memory content semantic, not raw data.

**Schema additions**
- `memories(...)` with pgvector HNSW index.
- `memory_proposals(...)` (pending accept/reject).

**Risks**
- Memory bloat poisons the context. Cap retrieval to ~10 items,
  weight by recency + confidence + relevance, decay old preferences.
- User says "forget that" — must actually delete, not just hide.

**DoD**
- Telling the agent "Costco usually counts as groceries" once
  changes future categorization without re-prompting.
- Setting a manual home value sticks across syncs and is cited as
  the source.

---

### Phase 6 — Goal-Based Planning

**Goal:** The agent derives budgets/plans from goals and tracks
progress.

**Tasks**
1. `goals` table: `(kind, target_amount, target_date, priority,
   constraints jsonb, status)`. Kinds: `save_for`,
   `accelerate_debt`, `reduce_category_spend`, `increase_savings_rate`.
2. Planner tool `propose_plan(goal_id)`:
   - Reads cash flow trends, recurring bills, categories, current
     savings rate.
   - Outputs a *plan*: monthly target deltas per category +
     suggested automated transfer + projected timeline.
   - Returned as a `pending_change` for user approval.
3. `budgets` table: monthly category caps with provenance (goal_id,
   created_by, manual_override).
4. Progress tracking: nightly job computes goal progress, surfaces
   anomalies, optionally notifies via email.
5. What-if simulator: agent tool `simulate(plan, scenario)` returns
   a projected net-worth curve under assumptions; render in chat.
6. Multi-goal arbitration: simple priority + greedy allocator first;
   defer LP/solver-based optimization unless needed.

**Schema additions**
- `goals(...)`, `budgets(...)`, `goal_progress(...)`.

**Risks**
- Over-promising forecasts. Always show confidence bands and label
  forecasts as scenarios, never predictions.
- Plans that ignore irregular income (bonuses, variable W-2).
  Surface this assumption explicitly and let the user pin it.

**DoD**
- "Build a plan to save another $1,500/month" produces a concrete,
  approvable plan grounded in real spend patterns, and on approval
  creates budgets + a tracking goal that updates monthly.

---

## Suggested Build Order Within Each Phase

For every phase, follow the same micro-loop:
1. **Schema + migration** (Drizzle).
2. **Server-side query/handler** with unit test on a seeded DB.
3. **Tool / API route** with Zod validation.
4. **UI** (RSC for read, Server Action for write).
5. **Audit + telemetry** (audit_events, Sentry breadcrumbs, AI cost
   log).
6. **Manual override path** verified before considering it done.

---

## What to Defer (and revisit explicitly)

- Multi-user households with separate logins (model `household_id`
  now; activate later).
- Mobile app — PWA is enough until product-market fit with yourself.
- Real-time streaming syncs — Plaid webhooks + periodic poll cover
  it.
- Investment lot-level cost basis & tax — Phase 7+.
- Property/vehicle valuation API integration — manual override is
  fine until enrichment matters.

---

## First Week Concretely

Day 1: Repo scaffold, Neon DB, Clerk auth, Drizzle schema for
`users` + `accounts` + `transactions` + `audit_events`.

Day 2: Plaid Link + token exchange in Sandbox, store item.

Day 3: Inngest + `transactions/sync` cursor loop, idempotent upsert.

Day 4: Webhook handler + manual resync UI + disconnect.

Day 5: Net Worth + Cash Flow dashboards (read-only, real data).

Day 6–7: Stabilize, write seed/fixtures, basic e2e (Playwright) for
the Link flow and dashboard render.

By end of week 1 you have a functioning ingestion + read product —
the foundation every later phase plugs into.
