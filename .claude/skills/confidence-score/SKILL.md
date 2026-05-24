---
name: confidence-score
description: Evaluate a single decision gate and produce a 1–10 confidence score with a clear proceed/ask recommendation. Invoke this at every [GATE] point inside roadmap-execute or quick-task instead of running the scoring logic inline.
---

# Confidence Scoring

You have been invoked to evaluate one decision gate.
The calling skill has paused at a `[GATE]` and needs a score before it
can continue.

---

## Your job

1. **Identify the gate question** — it is the decision or uncertainty
   the calling skill passed you. If it is unclear, state it explicitly
   before scoring.

2. **Score 1–10** by weighing the factors below.

3. **Output the standard block** (required — the calling skill reads it):

   ```
   [Confidence: N/10 — <one-sentence rationale>]
   ```

4. **Emit a machine-parseable decision line** immediately after the
   block. It must be exactly one of these two forms, on its own line,
   with no surrounding prose, quotes, or punctuation:

   ```
   DECISION: PROCEED
   ```
   or
   ```
   DECISION: ASK — <single focused question for ask_user>
   ```

   - **PROCEED** — score ≥ 7. The calling skill **must** continue to
     the next workflow step immediately on its very next action. It
     **must not** call `ask_user`, `exit_plan_mode`, or emit any
     text-only "should I proceed?" turn for this gate. No human
     interaction. Auto-continue.
   - **ASK** — score < 7. The calling skill must call `ask_user` with
     exactly the question after the `—`, then wait for the response.

Then return control to the calling skill.

---

## Scoring factors

**Lower confidence (push toward ASK):**
- Docs are ambiguous, missing, or contradict each other
- Two or more viable approaches with substantially different tradeoffs
- Decision affects user-owned data, irreversible schema changes, or
  data loss
- A new LLM call with estimated per-request cost > $0.01
- The original prompt gives no signal about which direction to take

**Raise confidence (push toward PROCEED):**
- `docs/STATUS.md` unambiguously identifies the next task
- The phase plan already answers the design question
- Existing code establishes a clear pattern to follow
- The choice is low-risk and easily reversible
- The tradeoff is cosmetic or implementation-detail only

---

## Output contract

Always emit exactly:

```
[Confidence: N/10 — <rationale>]

DECISION: PROCEED
```

or

```
[Confidence: N/10 — <rationale>]

DECISION: ASK — <single focused question for ask_user>
```

**Binding contract for the calling skill (no exceptions):**

- **On `DECISION: PROCEED`**, the calling skill's very next action
  **must** be the next workflow step. It is **forbidden** to:
  - call `ask_user` for this gate,
  - call `exit_plan_mode` for this gate,
  - emit a text-only turn asking the user to confirm, approve, or
    acknowledge,
  - re-evaluate the decision inline ("but maybe I should still ask…").

  PROCEED is binding even if the gate is named "approval" or "plan
  approval" — the score has already established sufficient confidence
  to auto-continue. Treat any urge to confirm as a bug.

- **On `DECISION: ASK — <question>`**, the calling skill must call
  `ask_user` with exactly that question (no rephrasing, no bundling
  with other questions) and wait for the response before continuing.

Nothing else in the output. The calling skill resumes immediately
after reading the `DECISION:` line.
