# Phase 3 — AI Chat MVP

**Status:** 🔲 Not started  
**Estimated duration:** 1–2 weeks  
**Depends on:** Phase 1 complete (Phase 2 recommended)  
**Goal:** A streaming chat interface where the AI can answer financial
questions and propose safe edits via typed tools. Chat becomes the
primary interface; dashboards become supporting views.

Deliverable: Chat-first financial interaction.

---

## Tasks

### 1. Chat route + streaming UI
- `/chat` page with `useChat` (Vercel AI SDK)
- `POST /api/chat` route handler using `streamText`
- Message bubbles with role-based styling
- Streaming token rendering (no flash-of-content)
- Conversation sidebar: list sessions, create new, delete

### 2. Tool registry (`packages/ai/tools/`)
One file per tool. Each exports: Zod input schema, handler function,
Zod output schema.

**Read tools** (execute immediately, no approval needed):
- `get_accounts` — return user's accounts + balances
- `get_assets` — return user's assets with values and sources
- `get_transactions(filter)` — paginated, filterable transaction list
- `query_transactions(structured_filter)` — aggregations (sum by
  category, merchant, date range)
- `calculate_networth(asOf?)` — point-in-time net worth calculation
- `summarize_period(range)` — income, spending, savings summary for a period
- `forecast_cashflow(months)` — simple projection from recurring bills

**Write tools** (return proposals, never commit directly):
- `update_asset(id, fields)` — propose asset value/metadata change
- `tag_transaction(id, category)` — propose category override
- `create_rule_draft(predicate, action)` — propose a categorization rule

### 3. Tool registration
Register all tools in `packages/ai/tools/registry.ts`; pass to
`streamText` as the `tools` parameter.

### 4. Write-tool safety pattern
Write tools must:
1. Insert a `pending_changes` row (kind, payload, `status='pending'`)
2. Return the proposal ID + a human-readable description
3. The chat UI renders a diff card (Approve / Reject buttons)
4. On Approve → Server Action validates ownership → applies change
   inside a DB transaction → writes `audit_events` → marks
   `pending_changes.status='applied'` → revalidates affected routes
5. On Reject → marks `pending_changes.status='rejected'`, no write

### 5. System prompt
Injected context (assembled per-turn in the route handler):
- Current date and user timezone
- Accounts summary (names, types, approximate balances)
- Relevant memories (Phase 5 — placeholder injection point for now)
- Household context placeholder

Guardrails (hard-coded in prompt):
- Never compute totals yourself — always call the appropriate tool
- Never invent or estimate a transaction that isn't in the data
- No tax, legal, or medical advice
- Always cite the source when stating a number

### 6. Conversation persistence
- `chat_sessions` and `chat_messages` tables
- Load last N messages as context on each turn
- Auto-generate session title from first user message (async,
  background LLM call)

### 7. Cost + token logging
`logLlmCall(model, inputTokens, outputTokens, latencyMs, toolCalls[])` helper.
Persist to `llm_usage` table. Surface total cost in Settings.

### 8. Rate limiting
Postgres token-bucket or Upstash Redis. Cap: e.g. 50 requests/hour
per user. Return 429 with a friendly message.

---

## Schema Additions

```ts
// chat_sessions
id: uuid PK
user_id: uuid FK users
title: text nullable  // generated async
created_at / updated_at

// chat_messages
id: uuid PK
session_id: uuid FK chat_sessions
role: enum('user','assistant','tool')
content: jsonb   // text content or tool call/result
tool_calls: jsonb nullable
created_at

// pending_changes
id: uuid PK
user_id: uuid FK users
kind: text   // 'asset_update' | 'txn_tag' | 'rule_create' | ...
payload: jsonb
status: enum('pending','applied','rejected') DEFAULT 'pending'
applied_at: timestamptz nullable
created_at

// llm_usage
id: uuid PK
user_id: uuid FK users
model: text
input_tokens: int
output_tokens: int
latency_ms: int
tool_calls: jsonb nullable
estimated_cost_usd: numeric(10,6)
created_at
```

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Model hallucinates numbers | Strong system prompt: "never compute totals — call calculate_* tools" |
| Write tools commit without approval | Structural: write tools only return proposals, approval is a separate server action |
| Context window blows up with chat history | Truncate to last N messages + summarize older turns on demand |
| LLM costs spiral | `gpt-4o-mini` for simple lookups; Claude Sonnet only for complex reasoning; log all usage |

---

## Definition of Done

- [ ] "How much did I spend on groceries in October?" returns correct, tool-grounded number
- [ ] "Summarize my spending this month" produces a clear breakdown
- [ ] "Set my Tesla value to $48,000" produces an approval card; on approve, asset updates with `source='user'` and audit row written
- [ ] Rejected proposals never touch the database
- [ ] All conversations persist and are resumable
- [ ] Token usage logged per message
- [ ] Rate limit returns friendly error at threshold
