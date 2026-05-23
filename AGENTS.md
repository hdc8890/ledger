# AGENTS.md

Operating instructions for AI agents (and humans acting like agents)
contributing to this repository. Read this **before** planning,
designing, coding, or committing.

Companion docs:
- `ARCHITECTURE.md` — how the system is built
- `docs/ROADMAP.md` — what we're building and why
- `docs/STATUS.md` — current project state
- `docs/STACK.md` — stack rationale and cross-cutting concerns
- `docs/phases/` — per-phase executable build plans

---

## Doc Map — Read the Right Thing First

Every task starts by reading the right documents. Use this map.

### Before any task
| Question | Read |
|----------|------|
| What are we building? | `docs/ROADMAP.md` |
| Where are we right now? What phase? | `docs/STATUS.md` |
| What decisions are already locked? | `docs/STATUS.md` → Decisions Locked |
| How is the system designed? | `ARCHITECTURE.md` |
| What stack/tools do we use and why? | `docs/STACK.md` |
| What are the coding + commit rules? | This file (`AGENTS.md`) |

### When working on a specific phase
| Task | Read |
|------|------|
| Understand what to build in Phase 1 | `docs/phases/phase-1-foundation.md` |
| Understand what to build in Phase 2 | `docs/phases/phase-2-dashboards.md` |
| Understand what to build in Phase 3 | `docs/phases/phase-3-ai-chat.md` |
| Understand what to build in Phase 4 | `docs/phases/phase-4-enrichment.md` |
| Understand what to build in Phase 5 | `docs/phases/phase-5-memory.md` |
| Understand what to build in Phase 6 | `docs/phases/phase-6-planning.md` |

Each phase file contains: **goal**, **task breakdown**, **schema
additions**, **risks**, and **definition of done**. A phase is the
primary spec for what to build — do not contradict it without
updating the file.

### When the docs themselves need updating
| Situation | Update |
|-----------|--------|
| A phase starts or completes | `docs/STATUS.md` phase table |
| A new decision is made | `docs/STATUS.md` → move from Open to Locked |
| A blocker is discovered | `docs/STATUS.md` → Blockers |
| System design changes | `ARCHITECTURE.md` |
| Stack choice changes | `docs/STACK.md` + `ARCHITECTURE.md` |
| Phase scope changes | The relevant `docs/phases/phase-N-*.md` |
| New coding rule needed | `AGENTS.md` |

### Doc authority hierarchy
When docs conflict, this order wins:

1. `docs/STATUS.md` — overrides everything for current project state
2. `ARCHITECTURE.md` — overrides phase plans for system design
3. `docs/phases/phase-N-*.md` — overrides general stack doc for
   phase-specific decisions
4. `docs/STACK.md` — baseline for all phases
5. `docs/ROADMAP.md` — product vision; doesn't prescribe
   implementation details

If you find a conflict between docs, fix the lower-priority doc to
match the higher-priority one, and note the change in the PR.

---

## 0. Prime Directives

1. **Manual overrides always win.** Never write user-owned data
   without an explicit approval path. If in doubt, propose, don't
   commit.
2. **Every AI write is auditable.** `source`, `confidence`, and an
   `audit_events` row are non-negotiable.
3. **Never invent numbers.** If a tool exists to compute it, call
   the tool. Do not let the model do arithmetic on financial data.
4. **Idempotency is mandatory** for any ingestion or sync path.
5. **Confidence over false precision.** Prefer "≈$1,240 (low
   confidence)" to "$1,243.71" when the data isn't authoritative.
6. **Keep diffs small and reviewable.** One concern per PR.

---

## 1. Planning & Designing

Before writing code:

- **Read first.** Open `ARCHITECTURE.md`, `docs/STATUS.md` (current
  phase + locked decisions), the relevant phase plan in
  `docs/phases/`, and the existing schema in
  `packages/db/schema.ts`. Do not duplicate or contradict them.
- **State the goal in one sentence** in your plan or PR
  description. If you can't, you don't understand the task yet.
- **Identify the layer** you're modifying (ingestion /
  normalization / enrichment / agent tool / surface) and stay
  within it. Cross-layer changes need an explicit reason.
- **Schema changes first.** If a task requires new columns or
  tables, design the migration before writing any handler or UI.
- **Consider the override path** for any new AI-written field:
  how does the user correct it? Where is it persisted? Does it
  produce a memory?
- **Prefer extending existing tables** over creating parallel
  ones. Resist new tables that duplicate concepts already in
  `transactions` / `assets` / `memories`.
- **Write the tool schema first** when adding an agent tool. The
  Zod schema is the contract.
- **Cost & latency awareness.** If your change adds an LLM call,
  estimate per-request cost and whether the call belongs on the
  hot path or in a background job.

When unsure between two approaches, write 3–5 lines comparing
them in the PR description rather than picking silently.

---

## 2. TypeScript Best Practices

This is a TS-first repo. Treat the compiler as your first reviewer.

### Strictness
- `tsconfig` runs with `"strict": true`,
  `"noUncheckedIndexedAccess": true`,
  `"noImplicitOverride": true`,
  `"exactOptionalPropertyTypes": true`. Do not loosen these.
- **No `any`.** If you truly need an escape hatch, use `unknown`
  and narrow. `as` casts require a one-line comment justifying
  them.
- **No non-null assertions (`!`).** Narrow with conditionals or
  early returns.
- **No `@ts-ignore`.** `@ts-expect-error` with an explanation is
  acceptable only for known compiler/library bugs.

### Types
- Prefer `type` for unions/aliases, `interface` for object shapes
  that may be extended.
- Domain models are derived from Drizzle/Zod — do not hand-write
  parallel TS types. `z.infer<typeof Schema>` and
  `InferSelectModel<typeof table>` are the patterns.
- Use **discriminated unions** for variant data
  (`type Change = { kind: 'asset_update'; ... } | { kind: 'tag'; ... }`).
- Use **branded types** for IDs and money to prevent mixups:
  `type UserId = string & { readonly __brand: 'UserId' }`.
  Helpers live in `packages/shared`.
- `readonly` everything that doesn't need to mutate (arrays,
  fields, function params).
- Exhaustiveness: end `switch` on a union with
  `default: const _: never = x; throw new Error(...)`.

### Functions & modules
- One responsibility per function. If you need "and" in the
  description, split it.
- Pure functions in `packages/shared`. Side effects (DB, network)
  live in clearly-named modules (`*.repo.ts`, `*.client.ts`).
- Named exports only. No default exports (except where Next.js
  requires them — page/layout/route files).
- Co-locate Zod schemas with the function that consumes them; the
  schema is the canonical type.

### Async & errors
- `async/await` only. No `.then()` chains.
- Top-level `await` is fine in scripts; never in library code.
- Throw `Error` subclasses with stable names
  (`class PlaidSyncError extends Error`). Catch narrowly.
- **Never swallow errors.** If you handle one, log it and decide
  recovery explicitly.
- Server actions and route handlers wrap everything in a single
  `try` and convert thrown errors to typed responses; raw stack
  traces never reach the client.

### Money & time
- All money is `bigint` cents. Never `number`. Use helpers in
  `packages/shared/money.ts`.
- All timestamps stored UTC `Date` / `timestamptz`. Use
  `date-fns-tz` (or equivalent) for user-TZ rendering. Never
  format dates with `toString()`.

### React / Next.js
- Default to **React Server Components**. A `'use client'`
  pragma needs justification (interactivity, browser API,
  context).
- Data fetching belongs in RSC or server actions, not in
  client effects. No `useEffect`-driven `fetch` to internal
  APIs.
- Server actions: validate input with Zod *first*, then
  authorize, then act.
- No client-side secrets. `process.env.X` in client code is a
  bug unless `NEXT_PUBLIC_*`.
- Tailwind class lists: keep ordered (use `prettier-plugin-tailwindcss`).
- `shadcn/ui` components live in `apps/web/components/ui`. Don't
  fork them; extend via composition.

---

## 3. Database & Schema

- **One migration per logical change.** Never edit applied
  migrations. Make a new one.
- All foreign keys explicit; `ON DELETE` policy chosen
  deliberately (`cascade` only when the child genuinely cannot
  exist without the parent).
- Indexes added with the migration that introduces the query
  pattern, not after.
- Every table has `created_at` and `updated_at`; `updated_at` is
  maintained by trigger or explicit set.
- Soft-delete with `deleted_at` where the row carries history;
  hard delete only for ephemeral data (pending changes,
  proposals once resolved).
- Sensitive columns (Plaid access tokens) stored encrypted; never
  selected into logs.
- Repository functions in `packages/db/queries/*` are the only
  place SQL or Drizzle query builders live. Route handlers /
  server actions call repo functions; they don't query directly.

---

## 4. AI Tools

When adding or modifying an agent tool:

1. Define the **Zod input schema** in `packages/ai/tools/<tool>.ts`.
2. Implement the **handler** as a pure function of
   `(input, ctx) => Promise<Result>`. `ctx` carries the
   authenticated user and a DB handle.
3. Define the **output schema** (also Zod). The model sees
   structured output, not free text, wherever feasible.
4. Register the tool in `packages/ai/tools/registry.ts`.
5. **Write tools must return a proposal, not commit.** Insert a
   `pending_changes` row and return its ID + a human-readable
   summary.
6. Add a **unit test** with a fixture DB exercising at least the
   happy path and one validation failure.
7. Update the system prompt only if the tool requires new usage
   guidance — keep the prompt lean.

Tool naming: snake_case, verb-first, scoped (`get_*`,
`query_*`, `calculate_*`, `update_*`, `propose_*`,
`save_*`). Match the roadmap names where they exist.

---

## 5. Testing

- **Vitest** for unit + integration. **Playwright** for e2e of
  critical user flows (Plaid Link, chat approve-write,
  dashboard render).
- Test the **repository layer** against a real ephemeral
  Postgres (Testcontainers or a per-test schema on Neon
  branching). Mocked DBs lie.
- Mock only at process boundaries (Plaid, LLM providers).
  Mocking your own code is a smell.
- Snapshot tests only for stable, semantic output (e.g. tool
  result shapes). Never snapshot rendered HTML for dashboards.
- Add a test for every bug fix that demonstrates the bug before
  the fix.

---

## 6. Observability

- **Sentry** captures unhandled errors and slow transactions.
  Server actions wrap with `Sentry.startSpan`.
- Structured logs via `pino`. No `console.log` in committed
  code (lint rule enforces).
- Every LLM call logs: model, prompt token count, completion
  token count, latency, cost estimate, tool calls invoked. Use
  a `logLlmCall` helper.
- Every Inngest function logs start/end with the relevant entity
  ID.

---

## 7. Git Practices

### Branch naming
- `feat/<short-kebab>` — new functionality
- `fix/<short-kebab>` — bug fixes
- `chore/<short-kebab>` — tooling, deps, refactors with no
  behavior change
- `docs/<short-kebab>` — documentation only
- `phase-<n>/<short-kebab>` — work tied to a roadmap phase

Keep branch names ≤ 50 chars. Examples:
`feat/plaid-link-flow`, `fix/transaction-dedupe`,
`phase-3/chat-tool-registry`.

### Commit format — Conventional Commits

```
<type>(<scope>): <imperative subject ≤ 72 chars>

<body — what & why, wrapped at 72 cols, optional>

<footer — issue refs, breaking changes, co-authors, optional>
```

- **Types**: `feat`, `fix`, `chore`, `refactor`, `docs`,
  `test`, `perf`, `build`, `ci`, `revert`.
- **Scope** (optional but encouraged): `db`, `plaid`, `chat`,
  `ai`, `ui`, `infra`, `auth`, `enrichment`, `memory`,
  `dashboards`, `inngest`.
- **Subject**: imperative mood ("add X", not "added X" or
  "adds X"), no trailing period.
- **Body**: explain *why*, not *what* the diff already shows.
  Reference the phase or roadmap section if relevant.
- **Breaking changes**: include `BREAKING CHANGE:` in the
  footer; bump major if/when versioning matters.

Examples:
```
feat(plaid): add transactions/sync cursor loop

Replaces the deprecated /transactions/get with the incremental
sync endpoint. Cursor persisted per plaid_item; removed IDs are
soft-deleted to preserve audit history.

Refs: phase-1
```
```
fix(enrichment): exclude transfer-linked pairs from cash flow

Transfer detection ran, but the cash flow query wasn't joining
transfer_links. Spending was inflated by ~14% for accounts with
frequent internal transfers.
```

### Atomic commits
- One logical change per commit. A schema migration + its
  consumer code may be the same commit; a refactor + a feature
  is two.
- Prefer rebasing local branches over merge commits. Squash on
  merge unless preserving granular history is valuable.
- Never amend or force-push a branch others might have pulled.

### Co-authoring (when an agent contributes)
Include the Copilot co-author trailer on agent-assisted
commits:
```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

### Single-contributor workflow — no PRs
This is a single-contributor repository. **Do not open pull
requests.** The workflow is:

1. Create a local branch (or worktree) for implementation work.
2. Commit in logical groups on that branch (per the commit
   format rules above).
3. Run lint, typecheck, and tests locally until clean.
4. Merge the branch into `main` locally once the work is
   approved (e.g. `git merge --no-ff`).
5. Push `main` to origin.

Branches exist only as a local scratch space during development.
They are not intended to be long-lived or reviewed on GitHub.

### What never goes in a commit
- Secrets, tokens, real Plaid credentials, real financial data.
  `.env*` files are gitignored.
- Generated files that should be built (Drizzle migrations
  generated artifacts excepted — those are committed).
- Commented-out code. Delete it; git remembers.
- Unrelated reformat noise. Format-only commits live in their
  own `chore(format): ...` commit.

---

## 8. Definition of Done

A change is done when:

1. Types compile under strict mode.
2. Lint passes with zero warnings (warnings are errors).
3. New code has tests; bug fixes have regression tests.
4. Manual override path verified for any AI-written field.
5. `audit_events` row produced for any mutation outside
   ordinary user data entry.
6. Docs updated when public behavior, schema, or build steps
   changed (`ARCHITECTURE.md`, the phase plan, or this file).
7. Cost & latency considered for new LLM calls; documented in
   the PR if non-trivial.
8. The author would be comfortable defending every line in
   review.

---

## 9. Quick Checklists

### Planning a new feature
- [ ] Which roadmap phase?
- [ ] Which architectural layer?
- [ ] Schema changes needed?
- [ ] Manual override path defined?
- [ ] New AI calls — on the hot path or in a job?
- [ ] Audit + confidence + source fields where needed?

### Adding an agent tool
- [ ] Zod input + output schemas
- [ ] Pure handler in `packages/ai/tools/`
- [ ] Registered in tool registry
- [ ] Write tool? Returns `pending_changes`, no direct commit
- [ ] Unit test with at least happy + validation failure
- [ ] System prompt updated only if new guidance is required

### Before committing
- [ ] Conventional Commit subject (imperative, ≤72 chars)
- [ ] One logical change
- [ ] No secrets, no `console.log`, no commented-out code
- [ ] Tests run locally
- [ ] Typecheck + lint clean
- [ ] Co-authored-by trailer if agent-assisted
