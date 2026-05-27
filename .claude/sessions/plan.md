# Phase 5 Task 4 — Auto-Extraction Plan

**Goal**: After each chat turn, run a background job that proposes 0-3 memories worth saving; show as "Remember: X?" chips in the chat UI.

**Layer**: Memory layer + surfaces (chat UI)

**Schema changes**: None — `memory_proposals` table already exists.

## Files to add/modify

### DB queries (`apps/web/src/db/queries/memories.ts`)
- [x] Add `findRejectedProposalByText(userId, text)` — dedup check
- [x] Add `getProposalById(id)` — for server action ownership check

### Inngest job
- [x] New `apps/web/src/inngest/functions/extract-memories.ts`
  - Event: `memory/chat.extract`
  - Payload: `{ userId, sessionId, recentMessages: [{role, text}[]] }`
  - Uses `gpt-4o-mini`, strict JSON schema, 0-3 proposals
  - Skips text if same content already rejected
  - Inserts to `memory_proposals`
  - Logs LLM call
- [x] Export from `apps/web/src/inngest/index.ts`

### Chat route
- [x] Modify `apps/web/src/app/api/chat/route.ts`
  - Fire `memory/chat.extract` event in `onFinish` (fire-and-forget)

### Server actions
- [x] New `apps/web/src/app/actions/memory-proposals.ts`
  - `acceptProposalAction(id)` → marks accepted + calls saveMemory
  - `dismissProposalAction(id)` → marks rejected
  - `getSessionProposalsAction(userId)` → list pending for polling

### UI
- [x] New `apps/web/src/components/chat/memory-proposal-chip.tsx`
  - "Remember: [text]?" with Accept/Dismiss buttons
- [x] Modify `apps/web/src/components/chat/chat-window.tsx`
  - Poll for proposals after turn completes (1.5s delay, 3 attempts)
  - Show chips above input bar
- [x] Modify `apps/web/src/app/(dashboard)/chat/[sessionId]/page.tsx`
  - Pass `initialProposals` from server

### Tests
- [x] `apps/web/src/inngest/functions/__tests__/extract-memories.test.ts`
- [x] `apps/web/src/app/actions/__tests__/memory-proposals.test.ts`
- [x] `apps/web/src/components/chat/__tests__/memory-proposal-chip.test.tsx`
- [x] Update `apps/web/src/db/queries/__tests__/memories.test.ts` for new functions

## AI/LLM impact
- Model: `gpt-4o-mini` (cheap, ~$0.0001 per call)
- Runs post-turn in background Inngest job — not on hot path
- No override path needed (proposals are optional; user explicitly accepts)

## Definition of done
- [ ] Types compile under strict mode
- [ ] Lint passes with zero warnings
- [ ] Tests added; `pnpm test` green; coverage ≥ 70%
- [ ] Audit events written for accepted memories (via saveMemory)
- [ ] No raw amounts/account numbers in proposed memory text

## Commit plan
1. `feat(memory): add proposal query helpers`
2. `feat(memory): implement extract-memories Inngest job`
3. `feat(memory): add memory proposal server actions`
4. `feat(memory): add MemoryProposalChip component and wire into chat UI`
5. `docs(status): update Phase 5 task 4 to done`
