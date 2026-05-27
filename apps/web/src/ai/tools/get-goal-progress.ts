import { z } from 'zod';
import { getActiveGoalsByUserId } from '@/db/queries/goals';
import { getGoalProgressForPeriod, getLatestGoalProgress } from '@/db/queries/goal-progress';
import { centsToNumber } from '@/shared/money';
import { goalKindSchema } from './create-goal';
import type { ToolContext } from './context';
import type { GoalId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const inputSchema = z.object({
  /**
   * Calendar period to query in YYYY-MM-DD (first day of the month).
   * Defaults to the current calendar month when omitted.
   */
  period: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'period must be YYYY-MM-DD')
    .optional(),
});

const goalProgressItemSchema = z.object({
  goalId: z.string(),
  name: z.string(),
  kind: goalKindSchema,
  /** True when on track for the current period; null when no progress data has been computed yet. */
  onTrack: z.boolean().nullable(),
  /**
   * Actual value in dollars for the period.
   * For reduce_category_spend: total spending against budgeted categories.
   * For save_for / increase_savings_rate / accelerate_debt: net savings.
   * Null when no progress data has been computed yet.
   */
  actualDollars: z.number().nullable(),
  /**
   * Target value in dollars for the period.
   * For reduce_category_spend: sum of monthly budget caps.
   * For save_for / increase_savings_rate / accelerate_debt: monthly savings target.
   * Null when no progress data has been computed yet.
   */
  targetDollars: z.number().nullable(),
  /**
   * Percentage of actual vs target (0–150+).
   * For reduce_category_spend: spending as % of cap — higher is worse.
   * For other kinds: savings as % of target — higher is better.
   * Null when target is 0 or no data.
   */
  progressPercent: z.number().nullable(),
  /** Human-readable anomaly messages surfaced by the nightly tracking job. */
  anomalies: z.array(z.string()),
  /** Days remaining in the reporting period at the time of last computation. */
  daysRemainingInPeriod: z.number().nullable(),
  /** Calendar period the progress data covers (YYYY-MM-DD, first of month). */
  progressPeriod: z.string().nullable(),
});

export const outputSchema = z.object({
  /** The queried period (YYYY-MM-DD, first day of month). */
  period: z.string(),
  /** Progress data for each active goal. */
  goals: z.array(goalProgressItemSchema),
  /** Rolled-up counts across all active goals. */
  summary: z.object({
    totalActive: z.number(),
    onTrackCount: z.number(),
    offTrackCount: z.number(),
    /** Goals with no progress data yet (nightly job has not run or goal was just created). */
    noDataCount: z.number(),
  }),
});

export type GetGoalProgressOutput = z.infer<typeof outputSchema>;

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function currentPeriod(): string {
  const now = new Date();
  const y = now.getUTCFullYear().toString();
  const m = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}-01`;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Return progress for all active goals for the requested period.
 *
 * Read-only — no writes, no proposals. Tries the exact requested period
 * first; falls back to the latest available row when the nightly job has
 * not yet computed the requested month (e.g. today is the 1st and the job
 * hasn't run, or the goal was just created).
 */
export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<GetGoalProgressOutput> {
  const period = input.period ?? currentPeriod();

  const activeGoals = await getActiveGoalsByUserId(ctx.userId);

  const progressRows = await Promise.all(
    activeGoals.map(async (g) => {
      const goalId = g.id as GoalId;
      return (await getGoalProgressForPeriod(goalId, period)) ?? getLatestGoalProgress(goalId);
    }),
  );

  let onTrackCount = 0;
  let offTrackCount = 0;
  let noDataCount = 0;

  const goalItems = activeGoals.map((goal, i) => {
    const progress = progressRows[i];

    let onTrack: boolean | null = null;
    let actualDollars: number | null = null;
    let targetDollars: number | null = null;
    let progressPercent: number | null = null;
    let anomalies: string[] = [];
    let daysRemainingInPeriod: number | null = null;
    let progressPeriod: string | null = null;

    if (progress) {
      onTrack = progress.onTrack;
      actualDollars = centsToNumber(progress.actualCents);
      targetDollars = centsToNumber(progress.targetCents);

      if (progress.targetCents > 0n) {
        progressPercent = Math.round(
          Number((progress.actualCents * 100n) / progress.targetCents),
        );
      }

      progressPeriod = progress.period;

      // Safe: notes are written exclusively by the nightly tracking job
      // using the GoalProgressNotes shape in db/queries/goal-progress.ts.
      const notes = progress.notes as import('@/db/queries/goal-progress').GoalProgressNotes | null;
      daysRemainingInPeriod = notes?.daysRemainingInPeriod ?? null;
      anomalies = notes?.anomalies ? [...notes.anomalies] : [];
    }

    if (onTrack === null) {
      noDataCount++;
    } else if (onTrack) {
      onTrackCount++;
    } else {
      offTrackCount++;
    }

    return {
      goalId: goal.id,
      name: goal.name,
      kind: goal.kind,
      onTrack,
      actualDollars,
      targetDollars,
      progressPercent,
      anomalies,
      daysRemainingInPeriod,
      progressPeriod,
    };
  });

  return {
    period,
    goals: goalItems,
    summary: {
      totalActive: activeGoals.length,
      onTrackCount,
      offTrackCount,
      noDataCount,
    },
  };
}
