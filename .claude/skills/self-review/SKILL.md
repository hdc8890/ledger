---
name: self-review
description: Run a full self-review of current staged/unstaged changes via a code-review subagent, address all material findings, and confirm lint/typecheck/tests are clean before returning. Invoke this after implementation is locally green, in place of running the review logic inline.
---

# Self-Review Workflow

You have been invoked to review and fix the current implementation before
it is committed. The calling skill (typically `roadmap-execute`) is
paused and waiting for a clean result.

---

## Step 1 — Determine scope

Read `docs/STATUS.md` to identify the current phase number so you can
reference the correct phase plan in the review prompt.

---

## Step 2 — Spawn code-review subagent

Spawn a `code-review` subagent in **sync mode** with the following
prompt (substitute the actual phase number for `N`):

> Review the staged + unstaged changes in this repository against
> `AGENTS.md` (especially §0 Prime Directives, §2 TypeScript, §3
> Database, §4 AI Tools) and the current phase plan in
> `docs/phases/phase-N-*.md`. Flag only material issues: bugs,
> security problems, schema/migration mistakes, missing override or
> audit paths, missing/weak tests, incorrect money/time handling,
> tool-contract violations. Ignore style and trivial nits. Cite
> file:line for each finding.

Do **not** proceed until the subagent returns.

---

## Step 3 — Address findings

For each finding the subagent returned:

- **Fix material issues** directly in the code.
- **Push back** on findings you disagree with — document your reasoning
  in writing to the user. Never silently ignore a finding.
- **Re-run** `pnpm lint`, `pnpm typecheck`, and `pnpm test` after any
  fixes. Iterate until clean.

If a finding reveals a **design-level problem** (e.g. wrong layer,
schema should change, missing audit path), do not patch over it.
Instead, report it explicitly to the calling skill and recommend looping
back to the planning step.

---

## Step 4 — Return summary

Report back to the calling skill with:

- Total findings; how many were fixed; how many were pushed back on
  (with brief reason for each pushback).
- Whether any design-level issues require replanning (yes/no; details
  if yes).
- Confirmation that `pnpm lint`, `pnpm typecheck`, and `pnpm test` are
  all clean.

The calling skill may proceed to commit only after this summary confirms
no outstanding material issues and a clean build.
