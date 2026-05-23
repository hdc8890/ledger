---
name: roadmap-execute
description: Pick up the next roadmap item, build context, plan, execute (code + tests), self-review via subagent, address findings, then commit/push and update project status docs. Use this when the user says things like "work on the next roadmap item", "move the project forward", "do the next phase task", or otherwise asks for substantive roadmap-driven work.
---

# Roadmap Execution Workflow

You are executing a non-trivial roadmap item end-to-end. Follow the DAG
below in order. Do **not** skip steps; each one gates the next.

Authority and doc rules come from `AGENTS.md`. Re-read its "Doc Map" and
"Prime Directives" sections before starting if you haven't this session.

---

## Self-Confidence Protocol

At each decision gate marked **[GATE]** below, rate your confidence
**1–10** before deciding whether to proceed or ask the human.

**Threshold: 7 — proceed automatically if confidence ≥ 7; pause and ask
the human if confidence < 7.**

Always output your rating in a brief inline block:
```
[Confidence: N/10 — <one-sentence rationale>]
```

**Factors that lower confidence (push toward asking):**
- Docs are ambiguous, missing, or contradict each other
- Two or more viable approaches with substantially different tradeoffs
- Decision affects user-owned data, irreversible schema changes, or
  data loss
- A new LLM call with estimated per-request cost > $0.01
- The original prompt gives no signal about which direction to take

**Factors that raise confidence (push toward self-deciding):**
- STATUS.md unambiguously identifies the next task
- The phase plan already answers the design question
- Existing code establishes a clear pattern to follow
- The choice is low-risk and easily reversible
- The tradeoff is cosmetic or implementation-detail only

---

## Step 1 — Understand what to work on next

Read, in this order:

1. `docs/STATUS.md` — current phase, locked decisions, blockers.
2. `docs/ROADMAP.md` — overall direction (only for orientation).
3. The phase plan file referenced as current in STATUS
   (`docs/phases/phase-N-*.md`).
4. `ARCHITECTURE.md` — only the sections relevant to the candidate task.

From these, identify **the single next task** to work on. Prefer the
top unfinished task in the current phase plan. If STATUS lists a
blocker that affects it, surface the blocker before proceeding.

Output to the user: a 2–4 line summary of "what" and "why this is
next", and the phase + section it comes from.

**[GATE — task selection]** Rate your confidence that you have
identified the correct next task. If confidence ≥ 7, proceed to Step 2
immediately. If confidence < 7, use `ask_user` to confirm the task with
the user before continuing.

## Step 2 — Build context and clarify

For the chosen task:

- Read the existing schema (`packages/db/schema.ts`) if the task
  touches data.
- Read the relevant layer's existing code (ingestion / normalization /
  enrichment / agent tool / surface — pick one and stay in it per
  `AGENTS.md` §1).
- Identify any cross-cutting concerns from `docs/STACK.md`.
- List open questions that genuinely block a good design. Examples:
  ambiguous behavior, choice between two reasonable approaches,
  unclear override path for an AI-written field, unclear cost/latency
  tradeoff for a new LLM call.

**[GATE — blocking questions]** For each open question, rate your
confidence that you can resolve it from existing docs and code alone.
- If confidence ≥ 7 for a question: make a reasoned decision, document
  your choice and rationale inline, and continue.
- If confidence < 7 for a question: use `ask_user` (one focused
  question at a time). Do not invent answers to low-confidence
  questions.
If there are no open questions, say so and continue.

## Step 3 — Create an execution plan

Write a plan to the session plan file (`plan.md` in the session
folder). Include:

- **Goal** — one sentence.
- **Layer** — which architectural layer this touches.
- **Schema changes** — migrations needed (or "none"), with the
  intended `ON DELETE` policies and indexes.
- **Files to add/modify** — concrete paths.
- **AI/LLM impact** — any new LLM calls, hot path vs job, estimated
  cost, override path for any AI-written field.
- **Tests** — what unit/integration/e2e tests you'll add, including
  the regression test for any bug being fixed.
- **Audit/confidence/source** — where these fields are produced.
- **Definition of done** — copy the relevant items from `AGENTS.md`
  §8.
- **Commit plan** — one logical commit per concern; planned
  Conventional Commit subjects.

Then show a compact summary to the user.

**[GATE — plan approval]** Rate your confidence in the plan's
correctness and completeness. If confidence ≥ 7, proceed to Step 4
immediately without waiting for user approval. If confidence < 7, call
`exit_plan_mode` and wait for explicit user approval before coding.

## Step 4 — Execute (code + tests together)

Implement the plan. While doing so:

- Schema migration **first**, then the code that consumes it.
- TypeScript: strict mode, no `any`, no `!`, no `@ts-ignore`. Money is
  `bigint` cents. Timestamps UTC. See `AGENTS.md` §2.
- For any new agent tool: Zod input + output schemas, pure handler,
  registered in `packages/ai/tools/registry.ts`, write-tools return a
  `pending_changes` proposal (no direct commit).
- Repository functions are the only place query builders live.
- Add tests alongside the code. Bug fix → regression test that fails
  before the fix.
- Run the project lint, typecheck, and tests. Treat warnings as
  errors. Iterate until clean.

Update `plan.md` checkboxes as you complete sub-steps so the user can
follow progress.

## Step 5 — Self-review via subagent

Once the implementation is green locally, spawn a `code-review`
subagent with this prompt template (fill in the diff scope):

> Review the staged + unstaged changes in this repository against
> `AGENTS.md` (especially §0 Prime Directives, §2 TypeScript, §3
> Database, §4 AI Tools) and the current phase plan in
> `docs/phases/phase-N-*.md`. Flag only material issues: bugs,
> security problems, schema/migration mistakes, missing override or
> audit paths, missing/weak tests, incorrect money/time handling,
> tool-contract violations. Ignore style and trivial nits. Cite
> file:line for each finding.

Use sync mode for code-review. Do **not** proceed past this step
until the review returns.

## Step 6 — Address findings

For each finding from Step 5:

- Fix material issues directly.
- Push back (in writing, to the user) on findings you disagree with,
  with reasoning. Don't silently ignore.
- Re-run lint / typecheck / tests after fixes.

If the review surfaces a design-level problem, loop back to Step 3
and update `plan.md` rather than patching over it.

## Step 7 — Commit and push

- Stage in **logical groups**, one Conventional Commit per group
  (`AGENTS.md` §7). Subjects imperative, ≤72 chars. Scope is one of:
  `db`, `plaid`, `chat`, `ai`, `ui`, `infra`, `auth`, `enrichment`,
  `memory`, `dashboards`, `inngest`.
- Include the body: *why*, not *what*. Reference the phase
  (`Refs: phase-N`) and any issue.
- Add the trailer:
  `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`
- Branch name: `phase-<n>/<short-kebab>` for roadmap work. Create it
  if you're still on `main`.
- Push to origin. Do **not** open a PR unless the user asked for one.

## Step 8 — Update project status

Update `docs/STATUS.md`:

- Move the task's row to its new state (in progress → done, or note
  partial completion).
- Promote any newly-locked decisions from "Open" to "Decisions
  Locked".
- Add/clear blockers as appropriate.

If the phase itself completed, also update the phase table in
`docs/STATUS.md` and, if scope changed, the relevant
`docs/phases/phase-N-*.md`.

Commit these doc changes as a separate `docs(...)` commit (per
`AGENTS.md` §7 — one logical change per commit). Push.

## Step 9 — Report

Tell the user, briefly:

- What was done (1–2 lines).
- Commits created (subjects only).
- Any deferred follow-ups, with suggested next task.

---

## Guardrails

- **Never write user-owned data** without an explicit approval path.
- **Never invent numbers** — call a tool to compute, never let the
  model do arithmetic on financial data.
- **Idempotency** is mandatory for any ingestion or sync path.
- If at any step the work expands beyond the originally-planned
  scope, **stop and replan** (return to Step 3). Do not silently
  grow the diff.
- One concern per PR/commit — split aggressively rather than bundle.
