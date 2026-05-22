# Phase 6 — Goal-Based Planning

**Status:** 🔲 Not started  
**Estimated duration:** 2–3 weeks  
**Depends on:** Phase 5 (Memory Layer)  
**Goal:** The agent derives budgets and actionable plans from high-level
goals, tracks progress automatically, and surfaces when the household
is on or off track.

Deliverable: Conversational goal-to-budget pipeline grounded in real
spend patterns.

---

## Tasks

### 1. Goal model
- `goals` table with kinds: `save_for`, `accelerate_debt`,
  `reduce_category_spend`, `increase_savings_rate`
- Agent tool `create_goal(kind, target_amount?, target_date?, constraints?)`
  — write tool, goes through approval flow
- Goals UI under `/goals`: list, status, edit, archive

### 2. Planner tool (`propose_plan`)
- Agent tool `propose_plan(goal_id)` reads:
  - 3-month average income + spending by category
  - Recurring bills and committed expenses
  - Current savings rate
  - Other active goals (for arbitration)
- Outputs a structured plan object:
  - Monthly delta targets per category (e.g. "reduce Dining by $200")
  - Suggested savings transfer amount
  - Projected timeline to goal
  - Assumptions made (listed explicitly)
- Returned as a `pending_changes` proposal for user approval

### 3. Budget model
- `budgets` table: monthly category caps with full provenance
- On plan approval → create `budgets` rows for relevant period
- Budgets are soft caps — agent surfaces overruns, doesn't block transactions
- Manual override flag per budget row

### 4. Progress tracking
- Nightly Inngest job: compute `goal_progress` for each active goal
- Compare actual spend/savings vs plan
- Surface anomalies: "You're $340 over your Dining budget with 8 days left"
- Future: email/push notification hook (Phase 7)

### 5. What-if simulator
- Agent tool `simulate(scenario)`:
  - `scenario`: e.g. `{ reduce: { Dining: 200, Shopping: 150 } }`
  - Returns projected net-worth curve over 12 months under assumptions
  - Rendered as a chart card in chat
- Always labeled as "scenario" not "prediction"; show confidence band

### 6. Multi-goal arbitration
- When multiple active goals compete for the same discretionary
  dollars, use priority + greedy allocation (highest-priority goal
  gets first claim)
- Surface conflicts explicitly: "Saving for a car and accelerating
  your mortgage compete — which takes priority?"
- Defer LP/solver-based optimization to a future phase

### 7. Budget vs actual UI
- `/budgets` page: current month's budgets with actual vs cap bars
- Color coding: green < 80%, yellow 80–100%, red > 100%
- Click-through to underlying transactions

---

## Schema Additions

```ts
// goals
id: uuid PK
user_id: uuid FK users
kind: enum('save_for','accelerate_debt','reduce_category_spend','increase_savings_rate')
name: text
target_amount_cents: bigint nullable
target_date: date nullable
priority: int DEFAULT 0
constraints: jsonb   // { exclude_categories: [...], max_monthly_reduction: ... }
status: enum('active','achieved','archived','paused') DEFAULT 'active'
created_at / updated_at

// budgets
id: uuid PK
user_id: uuid FK users
goal_id: uuid FK goals nullable
period: date    // first day of the month
category: text
cap_cents: bigint
manual_override: boolean DEFAULT false
created_by: enum('user','ai') DEFAULT 'ai'
created_at / updated_at
UNIQUE (user_id, period, category)

// goal_progress
id: uuid PK
goal_id: uuid FK goals
period: date
actual_cents: bigint
target_cents: bigint
on_track: boolean
notes: jsonb nullable
created_at
UNIQUE (goal_id, period)
```

---

## Risks

| Risk | Mitigation |
|------|-----------|
| Over-promising forecasts | Always show confidence bands; label as scenarios not predictions; call out explicit assumptions |
| Irregular income (bonuses, variable W-2) | Surface the assumption about income explicitly; let user pin a fixed income figure |
| Multi-goal conflicts | Surface conflicts in natural language; never silently under-fund a goal |
| Plan becomes stale | Nightly progress job detects > 2-month-old plan; agent proactively suggests re-running `propose_plan` |

---

## Definition of Done

- [ ] "Create a plan to save an extra $1,500/month" produces a concrete, approvable plan grounded in actual spend history
- [ ] On approval, `budgets` rows created and visible in `/budgets`
- [ ] Nightly job tracks progress and surfaces overruns in chat or notification
- [ ] What-if simulation renders a projected net-worth chart in chat
- [ ] Multiple goals arbitrated by priority with explicit conflict surfacing
- [ ] All plan assumptions listed in the proposal card
