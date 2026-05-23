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

4. **Recommend an action** immediately after the block:
   - **PROCEED** — score ≥ 7; the calling skill **must** continue to the
     next step immediately. **Do NOT call `ask_user`, `exit_plan_mode`,
     or any other user-facing prompt. No human interaction. Auto-continue.**
   - **ASK** — score < 7; provide a single focused question that the
     calling skill should pass to `ask_user` before continuing.

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

PROCEED   ← or →   ASK: "<single focused question for ask_user>"
```

**Contract for the calling skill:**
- **PROCEED**: move to the next step immediately for this gate. Do **not**
  call `ask_user`, `exit_plan_mode`, or any user-facing prompt for this
  gate. Auto-continue to the next step.
- **ASK**: call `ask_user` with exactly the question provided, then wait
  for the user's response before continuing.

Nothing else. The calling skill resumes immediately after reading
your output.
