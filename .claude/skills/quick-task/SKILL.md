---
name: quick-task
description: Handle a small, focused task — minor bug fix, doc update, tiny refactor, dependency bump, lint fix — by first sizing it, then running only the steps that fit its shape. Use when the user asks for a small change that is clearly out-of-scope for full roadmap execution (e.g. "fix this typo", "update the README", "this function returns the wrong sign", "bump zod to latest").
---

# Quick Task Workflow

This skill is **adaptive**. Start by classifying the task; then run
only the steps required for that class. Do not over-process small
work.

Authority: `AGENTS.md` still applies (Prime Directives, TS rules,
commit format, co-author trailer). Skip steps the task doesn't need,
but never skip rules.

---

## Step 0 — Classify the task

Read the user's request. If the scope is genuinely unclear, ask **one**
clarifying question via `ask_user`, otherwise proceed.

Pick the closest class:

| Class | Examples | Path to follow |
|-------|----------|----------------|
| **A. Docs only** | README change, comment fix, AGENTS.md tweak, phase doc edit, typo | A1 → A2 → A3 |
| **B. Code bug fix** | Off-by-one, wrong return, broken handler, failing test | B1 → B2 → B3 → B4 → B5 → B6 |
| **C. Tiny refactor / rename** | Renaming a symbol, extracting a helper, no behavior change | C1 → C2 → C3 → C4 → C5 |
| **D. Dependency / config** | Bump version, tweak tsconfig, adjust lint rule | D1 → D2 → D3 → D4 |
| **E. Ambiguous / larger than it looks** | Touches schema, adds an AI call, spans layers | **Stop.** Recommend the `roadmap-execute` skill instead. |

If E, tell the user explicitly and suggest switching to
`roadmap-execute`. Don't proceed.

If complexity reveals itself mid-task (e.g. a "small bug" actually
needs a schema change), **stop and escalate** — surface this to the
user and recommend `roadmap-execute`.

---

## Path A — Docs only

A1. Make the edit(s). Keep them surgical and on-topic.
A2. Verify: render in head (no broken links/anchors), no formatting
    regressions. If the repo has a docs lint/build step, run it; if
    not, skip.
A3. Commit & push:
   - `docs(<scope>): <imperative subject>`
   - Body only if motivation is non-obvious.
   - Co-author trailer (`AGENTS.md` §7).
   - Branch: `docs/<short-kebab>` if not on a working branch.
   - No subagent review needed.

---

## Path B — Code bug fix

B1. **Reproduce.** Write a failing test that demonstrates the bug
    (`AGENTS.md` §5: "Add a test for every bug fix that demonstrates
    the bug before the fix"). If you cannot reproduce, stop and ask.
B2. **Fix** the bug. Stay within the relevant layer. No drive-by
    refactors.
B3. **Run** the project lint, typecheck, and the targeted tests
    (whole suite if cheap). Iterate until clean.
B4. **Self-review via subagent.** Spawn a `code-review` subagent
    (sync mode):

    > Review the staged + unstaged changes against `AGENTS.md`
    > (Prime Directives, TS rules, money/time handling, error
    > handling) and the test added for the bug. Flag only material
    > issues. Cite file:line.

B5. **Address findings.** Fix material issues; push back in writing
    on disagreements; re-run tests.
B6. **Commit & push:**
   - `fix(<scope>): <imperative subject>`
   - Body: what was broken and why the fix works (the
    *why*, not the *what*).
   - Co-author trailer.
   - Branch: `fix/<short-kebab>` if not on a working branch.

---

## Path C — Tiny refactor / rename

C1. Confirm there is **no behavior change**. If there is, this is not
    Path C — re-classify (likely Path B or escalate).
C2. Make the change. Prefer ecosystem tooling (LSP rename, codemod)
    over manual edits.
C3. Run lint, typecheck, tests. All must pass unchanged.
C4. Subagent review **only if** the change touches >5 files or any
    public API. Otherwise skip — a clean refactor with green tests
    is enough.
C5. Commit & push:
   - `refactor(<scope>): <imperative subject>`
   - Body: why the refactor is worth it.
   - Co-author trailer.
   - Branch: `chore/<short-kebab>` or `refactor/<short-kebab>`.

---

## Path D — Dependency / config

D1. Make the change in one file (e.g., `package.json`, `tsconfig`,
    eslint config). Run the install/sync command if needed
    (e.g., `pnpm install`).
D2. Run lint, typecheck, **and** tests. Config changes commonly
    break unexpected places — do not skip.
D3. If anything broke, fix it in the same commit *only if* the fix is
    trivial; otherwise stop and escalate to the user.
D4. Commit & push:
   - `chore(deps): <imperative subject>` or
     `build(<scope>): ...` / `ci(<scope>): ...` as appropriate.
   - Body: motivation, anything notable in the changelog of the
     upgraded dep.
   - Co-author trailer.
   - Branch: `chore/<short-kebab>`.

---

## Always — final report

After committing & pushing, give the user a 1–3 line summary:

- What was done.
- Commit subject(s).
- Anything they should know (skipped review and why, deferred
  follow-up, etc.).

Do **not** update `docs/STATUS.md` for quick tasks unless the change
actually affects roadmap state (rare). That is the
`roadmap-execute` skill's job.

---

## Guardrails (apply across all paths)

- Conventional Commits, imperative subject ≤72 chars, one logical
  change per commit (`AGENTS.md` §7).
- Co-author trailer on every commit.
- Never amend or force-push shared branches.
- No secrets, no `console.log`, no commented-out code in commits.
- TS rules from `AGENTS.md` §2 always apply, even for "tiny" edits.
- If the task grows mid-flight, **stop and escalate** rather than
  expanding scope silently.
