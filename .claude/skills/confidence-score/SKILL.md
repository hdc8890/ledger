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

   - **PROCEED** — score ≥ 7. The calling skill's next message must
     begin with the first tool call of the next workflow step. No
     text-only turn, no user-facing prompt of any kind for this gate.
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

- **On `DECISION: PROCEED`**, the calling skill's **next message must
  begin with the first tool call of the next workflow step.** No
  text-only turn between this output and that tool call. No request
  for user confirmation, approval, choice, or acknowledgement of any
  kind — regardless of how the gate is named ("approval", "review",
  "readiness", anything). The tool call itself is the acknowledgement
  that PROCEED was received.

  If the calling skill notices that an *earlier* gate in this
  conversation was violated (a user-facing tool was called after a
  prior PROCEED), that is a bug it already made — not a precedent to
  imitate. It should note the prior violation in one short line and
  comply with the contract from here forward. Do not let in-context
  pattern-matching override the contract.

- **On `DECISION: ASK — <question>`**, the calling skill must call
  `ask_user` with exactly that question (no rephrasing, no bundling
  with other questions) and wait for the response before continuing.

Nothing else in the output. The calling skill resumes immediately
after reading the `DECISION:` line.
