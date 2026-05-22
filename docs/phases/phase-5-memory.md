# Phase 5 — Memory Layer

**Status:** 🔲 Not started  
**Estimated duration:** 1–2 weeks  
**Depends on:** Phase 3 (AI Chat MVP)  
**Goal:** Give the agent persistent, personalized context that travels
across sessions. Preferences, household rules, and corrections the user
makes once should stick forever.

Deliverable: Personalized agent behavior. Long-term memory as core
product differentiation.

---

## Tasks

### 1. Memory table + pgvector index
- `memories` table with `embedding vector(1536)`
- `kind` enum: `preference | household_rule | historical_context | goal | override_note`
- Enable `pgvector` on Neon; create HNSW index for ANN search
- `packages/ai/memory.ts` — `saveMemory`, `retrieveMemories(query, k)`,
  `deleteMemory`, `listMemories` typed functions

### 2. Memory tools (agent-facing)
- `save_memory(text, kind, metadata?)` — write tool; persists directly
  (no approval needed for memory — user controls this via the UI)
- `delete_memory(id)` — agent can delete on user request
- `list_memories(kind?)` — returns paginated list for context

### 3. Memory retrieval on each chat turn
Before calling the LLM on every turn:
1. Embed the user's message with `text-embedding-3-small`
2. Query `memories` by cosine similarity (top-K = 10)
3. Filter by `confidence` threshold and recency weight
4. Inject as a `### Relevant Context` section in the system prompt
5. Cap total injected memory tokens (~800 tokens max)

### 4. Auto-extraction (post-turn)
After each assistant response:
- Background Inngest job runs a short LLM call with a strict JSON
  schema asking: "Does this conversation reveal a new preference,
  rule, or fact worth remembering?"
- Returns 0–3 proposed memories with kind + text + confidence
- Each appears as a "Remember: X?" chip in chat UI
- User Accept → insert to `memories`, compute + store embedding
- User Dismiss → insert to `memory_proposals` with `status='rejected'`
  (never re-propose the same content)

### 5. Override persistence
When a user corrects a category (Phase 4) or updates an asset value:
- The concrete write happens as normal
- Additionally, insert a `household_rule` memory:
  e.g. "Costco transactions should be categorized as Groceries"
- This ensures future AI categorization respects the rule without
  re-querying the rules table in every prompt

### 6. Memory management UI
Settings → Memory page:
- List all memories grouped by kind
- Edit memory text
- Delete memory (hard delete)
- Export memories as JSON
- "Clear all" with confirmation

### 7. Privacy guardrails
- Memory content is **semantic** — no raw dollar amounts, no
  account numbers, no institution names in embedded text
- Embedding is computed on sanitized text
- Raw transaction data never flows into the memory store

---

## Schema Additions

```ts
// memories
id: uuid PK
user_id: uuid FK users
kind: enum('preference','household_rule','historical_context','goal','override_note')
text: text                        // semantic content (no raw amounts/accounts)
embedding: vector(1536)           // pgvector, HNSW indexed
metadata: jsonb nullable          // { source_txn_id, related_asset_id, ... }
confidence: real DEFAULT 1.0
expires_at: timestamptz nullable
created_at / updated_at

// memory_proposals
id: uuid PK
user_id: uuid FK users
proposed_text: text
proposed_kind: text
source_session_id: uuid FK chat_sessions
status: enum('pending','accepted','rejected') DEFAULT 'pending'
created_at / updated_at
```

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Memory bloat poisons context | Hard cap of 10 injected memories per turn; decay confidence of old/unused memories; allow user to prune |
| User says "forget that" | Must delete from DB, not just hide. `delete_memory` tool does a hard delete |
| Auto-extraction false positives | User always approves before a proposal is committed; rejected proposals are never re-proposed |
| Embedding cost | `text-embedding-3-small` is ~$0.02/1M tokens — negligible at personal scale |

---

## Definition of Done

- [ ] "Costco usually counts as groceries" said once → future syncs categorize Costco as Groceries automatically
- [ ] Manual home value set in one session persists with `source='user'` citation in future chat turns
- [ ] "Remember: X?" chip appears after conversations that reveal a preference; accept/dismiss works
- [ ] Memory management page lists, edits, and hard-deletes memories
- [ ] Agent cites memory-derived context in responses ("Based on your preference, …")
- [ ] No raw amounts or account numbers appear in `memories.text`
