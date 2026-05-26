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

At each step marked **[GATE]** below, do a quick **inline** confidence
check. Do not call out to a separate scoring skill — scoring is part
of your reasoning at that gate, not a sub-agent.

### How to score (inline, in your head)

Weigh these factors and pick a number 1–10:

**Lower (push toward asking the user):**
- Docs ambiguous, missing, or contradictory
- Two+ viable approaches with materially different tradeoffs
- Decision affects user-owned data, irreversible schema, or data loss
- New LLM call with estimated per-request cost > $0.01
- Original prompt gives no signal on direction

**Higher (push toward continuing on your own):**
- `docs/STATUS.md` unambiguously identifies the task
- The phase plan already answers the design question
- Existing code establishes a clear pattern to follow
- Low-risk, easily reversible
- Tradeoff is cosmetic or implementation-detail only

### How to act on the score

Emit one short line at the gate:

```
[Confidence: N/10 — <one-line rationale>]
```

**Then, in the same response:**

- **If N ≥ 7** — continue to the next workflow step by emitting its
  first tool call **in the same response**, immediately after the
  confidence line. No text-only turn between scoring and acting. No
  user-facing tool (`ask_user`, `exit_plan_mode`, etc.) for this
  gate. The tool call itself is the acknowledgement.

- **If N < 7** — call `ask_user` with a single focused question
  (one question, no bundling) and wait for the response.

That's the whole protocol. There is no `DECISION:` line, no
"returning control", no skill boundary. Score and act in one turn.

### Why inline (and not a separate skill)

An earlier version of this workflow delegated scoring to a
`confidence-score` skill. That created a skill-result boundary
between scoring and acting, and the model would routinely stop or
ask the user at that boundary even when the score said proceed. The
boundary itself was the bug. Keep scoring inline. If a future you
is tempted to factor scoring out again, don't — that path is known
broken.

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

**[GATE — task selection]** Score inline against the question: *"Have
I identified the correct next task?"* Emit `[Confidence: N/10 — …]`
and in the same response either proceed to the first tool call of
Step 2 (typically reading the schema or relevant layer code) if
N ≥ 7, or call `ask_user` with a single focused question if N < 7.

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

**[GATE — open questions]** For each open question, score inline.
Emit `[Confidence: N/10 — …]` and in the same response either record
the resolution and move on (if N ≥ 7) or call `ask_user` with that
single question (if N < 7). Do not invent answers to low-confidence
questions.

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

**[GATE — plan readiness]** Score inline against the question: *"Is
this plan correct and complete enough to execute autonomously?"*

This is a self-check on plan quality, not an approval request. If
N ≥ 7 the plan is ready — execute it. There is no user approval step
in this workflow at this score.

Emit `[Confidence: N/10 — …]` and in the same response either:
- (N ≥ 7) begin Step 4 immediately by emitting the first tool call of
  the implementation (typically an `edit`/`create` on the first file
  in the plan, or a migration command). Do not summarize the plan
  again, do not request approval, do not call any user-facing tool.
- (N < 7) present the plan to the user with a single focused
  question (via `exit_plan_mode` or `ask_user`) and wait for their
  direction before coding.

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
