import { inngest } from '@/lib/inngest';
import { getAllUsers } from '@/db/queries/users';
import { getActiveGoalsByUserId } from '@/db/queries/goals';
import { getBudgetsByGoalId } from '@/db/queries/budgets';
import { upsertGoalProgress, type GoalProgressNotes } from '@/db/queries/goal-progress';
import { getPeriodSavings, getCategoryActuals } from '@/db/queries/planning';
import { centsToNumber } from '@/shared/money';
import type { GoalRow } from '@/db/queries/goals';
import type { BudgetRow } from '@/db/queries/budgets';
import type { PeriodSavings } from '@/db/queries/planning';
import type { UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

/** Return the first day of the current UTC calendar month (YYYY-MM-DD). */
export function currentPeriod(): string {
  const now = new Date();
  const y = now.getUTCFullYear().toString();
  const m = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}-01`;
}

/** Return the first day of the next UTC calendar month (YYYY-MM-DD). */
export function nextPeriod(period: string): string {
  const d = new Date(`${period}T00:00:00Z`);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return next.toISOString().slice(0, 10);
}

/** Count how many days remain in the calendar month starting at `period`. */
export function daysRemainingInPeriod(period: string): number {
  const now = new Date();
  const periodEnd = new Date(`${nextPeriod(period)}T00:00:00Z`);
  const diffMs = periodEnd.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

// ---------------------------------------------------------------------------
// Per-goal computation — exported for unit testing
// ---------------------------------------------------------------------------

export type GoalProgressInput = {
  readonly goalId: string;
  readonly period: string;
  readonly actualCents: bigint;
  readonly targetCents: bigint;
  readonly onTrack: boolean;
  readonly notes: GoalProgressNotes;
};

// ---------------------------------------------------------------------------
// Per-goal-kind progress computation
// ---------------------------------------------------------------------------

function computeReduceCategorySpend(
  goal: GoalRow,
  period: string,
  goalBudgets: readonly BudgetRow[],
  categoryActuals: Map<string, bigint>,
  daysRemaining: number,
): GoalProgressInput {
  if (goalBudgets.length === 0) {
    return {
      goalId: goal.id,
      period,
      actualCents: 0n,
      targetCents: 0n,
      onTrack: true,
      notes: {
        daysRemainingInPeriod: daysRemaining,
        anomalies: [],
        message: 'No budget plan approved for this goal yet — run propose_plan to create one.',
      },
    };
  }

  type CategoryNote = NonNullable<GoalProgressNotes['categories']>[number];
  const categoryNotes: CategoryNote[] = [];
  const anomalies: string[] = [];
  let totalActual = 0n;
  let totalTarget = 0n;

  for (const budget of goalBudgets) {
    const actual = categoryActuals.get(budget.category) ?? 0n;
    const target = budget.capCents;
    totalActual += actual;
    totalTarget += target;

    const overBy = actual - target;
    const status: 'under' | 'on_track' | 'over' =
      actual > target ? 'over' : actual >= target * 80n / 100n ? 'on_track' : 'under';

    categoryNotes.push({
      category: budget.category,
      actualCents: actual.toString(),
      targetCents: target.toString(),
      status,
    });

    if (actual > target) {
      const overDollars = centsToNumber(overBy);
      anomalies.push(
        `You're $${overDollars.toFixed(0)} over your ${budget.category} budget with ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left`,
      );
    }
  }

  return {
    goalId: goal.id,
    period,
    actualCents: totalActual,
    targetCents: totalTarget,
    onTrack: totalActual <= totalTarget,
    notes: {
      daysRemainingInPeriod: daysRemaining,
      anomalies,
      categories: categoryNotes,
    },
  };
}

function computeSaveFor(
  goal: GoalRow,
  period: string,
  periodSavings: PeriodSavings,
  daysRemaining: number,
): GoalProgressInput {
  const { savingsCents } = periodSavings;

  if (goal.targetAmountCents === null || goal.targetAmountCents <= 0n) {
    return {
      goalId: goal.id,
      period,
      actualCents: savingsCents,
      targetCents: 0n,
      onTrack: savingsCents >= 0n,
      notes: {
        daysRemainingInPeriod: daysRemaining,
        anomalies: [],
        message: 'No target amount set — run propose_plan to create a concrete savings plan.',
      },
    };
  }

  // Monthly target = totalTarget / monthsRemaining (same logic as propose_plan)
  let monthsRemaining = 12;
  if (goal.targetDate) {
    const targetMs = new Date(goal.targetDate).getTime();
    const nowMs = Date.now();
    monthsRemaining = Math.max(1, Math.ceil((targetMs - nowMs) / (1000 * 60 * 60 * 24 * 30.44)));
  }

  const monthlyTargetCents = goal.targetAmountCents / BigInt(monthsRemaining);
  const onTrack = savingsCents >= monthlyTargetCents;

  const anomalies: string[] = [];
  if (!onTrack) {
    const shortfall = monthlyTargetCents - savingsCents;
    const shortDollars = centsToNumber(shortfall);
    anomalies.push(
      `Savings are $${shortDollars.toFixed(0)} below your monthly target with ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left`,
    );
  }

  return {
    goalId: goal.id,
    period,
    actualCents: savingsCents,
    targetCents: monthlyTargetCents,
    onTrack,
    notes: { daysRemainingInPeriod: daysRemaining, anomalies },
  };
}

function computeIncreaseSavingsRate(
  goal: GoalRow,
  period: string,
  periodSavings: PeriodSavings,
  daysRemaining: number,
): GoalProgressInput {
  const { incomeCents, savingsCents } = periodSavings;
  // Target: 20% savings rate (same assumption as propose_plan)
  const targetCents = (incomeCents * 20n) / 100n;
  const onTrack = incomeCents === 0n ? true : savingsCents >= targetCents;

  const anomalies: string[] = [];
  if (!onTrack) {
    const shortfall = targetCents - savingsCents;
    const shortDollars = centsToNumber(shortfall);
    anomalies.push(
      `Savings are $${shortDollars.toFixed(0)} below the 20% savings rate target with ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left`,
    );
  }

  return {
    goalId: goal.id,
    period,
    actualCents: savingsCents,
    targetCents,
    onTrack,
    notes: { daysRemainingInPeriod: daysRemaining, anomalies },
  };
}

function computeAccelerateDebt(
  goal: GoalRow,
  period: string,
  periodSavings: PeriodSavings,
  daysRemaining: number,
): GoalProgressInput {
  const { savingsCents } = periodSavings;
  const targetCents = goal.targetAmountCents ?? 0n;

  if (targetCents <= 0n) {
    return {
      goalId: goal.id,
      period,
      actualCents: savingsCents,
      targetCents: 0n,
      onTrack: savingsCents >= 0n,
      notes: {
        daysRemainingInPeriod: daysRemaining,
        anomalies: [],
        message: 'No extra payment target set — run propose_plan to create a concrete debt plan.',
      },
    };
  }

  const onTrack = savingsCents >= targetCents;
  const anomalies: string[] = [];
  if (!onTrack) {
    const shortfall = targetCents - savingsCents;
    const shortDollars = centsToNumber(shortfall);
    anomalies.push(
      `Savings are $${shortDollars.toFixed(0)} below the extra debt payment target with ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} left`,
    );
  }

  return {
    goalId: goal.id,
    period,
    actualCents: savingsCents,
    targetCents,
    onTrack,
    notes: { daysRemainingInPeriod: daysRemaining, anomalies },
  };
}

// ---------------------------------------------------------------------------
// Top-level per-user computation — exported for unit testing
// ---------------------------------------------------------------------------

export type GoalProgressResult = {
  usersProcessed: number;
  usersFailed: number;
  goalsTracked: number;
  anomalyCount: number;
};

export type GoalProgressContext = {
  step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
};

/**
 * Compute and upsert goal_progress for all active goals of a single user
 * in the given period.
 *
 * Returns { goalsTracked, anomalyCount }.
 */
export async function computeAndUpsertGoalProgress(
  userId: UserId,
  period: string,
): Promise<{ goalsTracked: number; anomalyCount: number }> {
  const activeGoals = await getActiveGoalsByUserId(userId);
  if (activeGoals.length === 0) return { goalsTracked: 0, anomalyCount: 0 };

  const daysRemaining = daysRemainingInPeriod(period);

  // Fetch all data needed in parallel where possible.
  // split goals by kind to determine what data is needed
  const needsBudgets = activeGoals.filter((g) => g.kind === 'reduce_category_spend');
  const needsSavings = activeGoals.filter((g) => g.kind !== 'reduce_category_spend');

  const [categoryActuals, periodSavings, allGoalBudgets] = await Promise.all([
    needsBudgets.length > 0 ? getCategoryActuals(userId, period) : Promise.resolve(new Map<string, bigint>()),
    needsSavings.length > 0 ? getPeriodSavings(userId, period) : Promise.resolve({ incomeCents: 0n, spendingCents: 0n, savingsCents: 0n }),
    // Fetch goal-linked budgets for all reduce_category_spend goals
    Promise.all(needsBudgets.map((g) => getBudgetsByGoalId(g.id as Parameters<typeof getBudgetsByGoalId>[0], userId))),
  ]);

  // Map goalId → its budgets (only for reduce_category_spend goals)
  const budgetsByGoalId = new Map<string, BudgetRow[]>();
  for (let i = 0; i < needsBudgets.length; i++) {
    const goal = needsBudgets[i];
    const budgets = allGoalBudgets[i];
    if (goal && budgets) {
      // Filter to current period only
      const periodBudgets = budgets.filter((b) => b.period === period);
      budgetsByGoalId.set(goal.id, periodBudgets);
    }
  }

  const progressInputs: GoalProgressInput[] = [];
  for (const goal of activeGoals) {
    let input: GoalProgressInput;
    switch (goal.kind) {
      case 'reduce_category_spend': {
        const goalBudgets = budgetsByGoalId.get(goal.id) ?? [];
        input = computeReduceCategorySpend(goal, period, goalBudgets, categoryActuals, daysRemaining);
        break;
      }
      case 'save_for': {
        input = computeSaveFor(goal, period, periodSavings, daysRemaining);
        break;
      }
      case 'increase_savings_rate': {
        input = computeIncreaseSavingsRate(goal, period, periodSavings, daysRemaining);
        break;
      }
      case 'accelerate_debt': {
        input = computeAccelerateDebt(goal, period, periodSavings, daysRemaining);
        break;
      }
      default: {
        const _: never = goal.kind;
        throw new Error(`Unhandled goal kind: ${String(_)}`);
      }
    }
    progressInputs.push(input);
  }

  await Promise.all(
    progressInputs.map((p) =>
      upsertGoalProgress({
        goalId: p.goalId,
        period: p.period,
        actualCents: p.actualCents,
        targetCents: p.targetCents,
        onTrack: p.onTrack,
        notes: p.notes as Record<string, unknown>,
      }),
    ),
  );

  const anomalyCount = progressInputs.reduce((sum, p) => sum + p.notes.anomalies.length, 0);
  return { goalsTracked: progressInputs.length, anomalyCount };
}

// ---------------------------------------------------------------------------
// Inngest handler — exported for unit testing
// ---------------------------------------------------------------------------

export async function handleTrackGoalProgress(
  ctx: GoalProgressContext,
): Promise<GoalProgressResult> {
  const { step } = ctx;
  const period = currentPeriod();

  const userIds = await step.run('load-user-ids', async () => {
    const allUsers = await getAllUsers();
    return allUsers.map((u) => u.id);
  });

  let usersProcessed = 0;
  let usersFailed = 0;
  let goalsTracked = 0;
  let anomalyCount = 0;

  for (const userId of userIds) {
    const result = await step.run(`track-goals-user-${userId}`, async () => {
      try {
        const counts = await computeAndUpsertGoalProgress(userId as UserId, period);
        return { ok: true as const, ...counts };
      } catch (err) {
        console.error({ err, userId }, 'track-goal-progress: failed to compute progress for user');
        return { ok: false as const, goalsTracked: 0, anomalyCount: 0 };
      }
    });

    if (result.ok) {
      usersProcessed++;
      goalsTracked += result.goalsTracked;
      anomalyCount += result.anomalyCount;
    } else {
      usersFailed++;
    }
  }

  return { usersProcessed, usersFailed, goalsTracked, anomalyCount };
}

// ---------------------------------------------------------------------------
// Inngest function registration
// ---------------------------------------------------------------------------

/**
 * planning/track-goal-progress.daily — cron job that runs nightly at 03:00 UTC.
 *
 * For every user with active goals, computes goal_progress for the current
 * calendar month and upserts a row per goal. Anomalies (e.g. "over Dining
 * budget by $340") are stored in the notes field for surfacing in chat.
 */
export const trackGoalProgress = inngest.createFunction(
  {
    id: 'track-goal-progress-daily',
    name: 'Goal Progress Daily Tracker',
    triggers: [{ cron: '0 3 * * *' }],
  },
  handleTrackGoalProgress,
);
