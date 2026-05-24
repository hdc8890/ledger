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

## Decision Gates

At each step marked **[GATE]** below, invoke the `confidence-score`
skill by calling `skill("confidence-score")` and passing it the gate
question as context. The skill will return a `[Confidence: N/10]`
block followed by a single `DECISION:` line.

**Parse the `DECISION:` line strictly. It is binding.**

- `DECISION: PROCEED` → your **very next action must be the next
  workflow step**. You are **forbidden** to:
  - call `ask_user` for this gate,
  - call `exit_plan_mode` for this gate (even at the plan-approval
    gate — PROCEED *replaces* user approval),
  - emit a text-only turn asking the user to confirm, approve, or
    acknowledge,
  - re-derive the decision inline or second-guess the score.

  If you feel an urge to confirm with the user after PROCEED, treat
  it as a bug and suppress it. Auto-continue.

- `DECISION: ASK — <question>` → call `ask_user` with exactly that
  question (no rephrasing, no bundling) and wait for the response
  before continuing.

Do not run confidence scoring inline — always delegate to the skill
so it runs in a clean context window.

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

**[GATE — task selection]** Invoke `skill("confidence-score")` with the
gate question: *"Have I identified the correct next task?"*
- On `DECISION: PROCEED` → go straight to Step 2. No `ask_user`, no
  confirmation turn.
- On `DECISION: ASK — <question>` → call `ask_user` with that exact
  question, then continue.

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

**[GATE — blocking questions]** For each open question, invoke
`skill("confidence-score")` with the question as context.
- On `DECISION: PROCEED` → move on to the next question or to Step 3.
  No `ask_user` for that question.
- On `DECISION: ASK — <question>` → call `ask_user` with the exact
  question before continuing.

Do not invent answers to low-confidence questions.

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

**[GATE — plan approval]** Invoke `skill("confidence-score")` with the
gate question: *"Is this plan correct and complete enough to execute
without user approval?"*

- On `DECISION: PROCEED` → go **directly** to Step 4 and start
  implementing on your very next action. You are **forbidden** from
  calling `exit_plan_mode` or `ask_user` here. PROCEED at this gate
  *is* the approval — do not seek a second one from the user. This is
  the gate where the auto-continue rule is most often violated; treat
  any urge to call `exit_plan_mode` as a bug.
- On `DECISION: ASK — <question>` → call `exit_plan_mode` with a
  compact summary of the plan and wait for explicit user approval
  before coding.

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

## Step 5 — Self-review

Once the implementation is green locally, invoke the `self-review`
skill by calling `skill("self-review")`. The skill will run a
`code-review` subagent against `AGENTS.md` and the current phase plan,
address all material findings, re-run lint/typecheck/tests, and return a
summary.

Do **not** proceed to Step 6 until the skill returns a summary
confirming no outstanding material issues and a clean build. If the
skill reports a design-level problem, loop back to Step 3 and update
`plan.md` before re-invoking the skill.

## Step 6 — Commit and push

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

## Step 7 — Update project status

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

## Step 8 — Report

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
