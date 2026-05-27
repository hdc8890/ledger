import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { goalProgress } from '@/db/schema';
import type { GoalId, GoalProgressId } from '@/shared/types';

export type GoalProgressRow = typeof goalProgress.$inferSelect;
export type NewGoalProgress = typeof goalProgress.$inferInsert;

/**
 * Structured notes stored in goal_progress.notes.
 * Intentionally kept flat so callers can safely cast from jsonb.
 */
export type GoalProgressNotes = {
  readonly daysRemainingInPeriod: number;
  readonly anomalies: readonly string[];
  readonly categories?: ReadonlyArray<{
    readonly category: string;
    /** Bigint cents serialized as decimal string. */
    readonly actualCents: string;
    /** Bigint cents serialized as decimal string. */
    readonly targetCents: string;
    readonly status: 'under' | 'on_track' | 'over';
  }>;
  /** Human-readable context when no numeric target is available. */
  readonly message?: string;
};

/**
 * Upsert a goal_progress row. On conflict (goal_id, period) the row is
 * fully replaced (all fields updated) so the nightly job is idempotent.
 */
export async function upsertGoalProgress(input: NewGoalProgress): Promise<GoalProgressRow> {
  const rows = await db
    .insert(goalProgress)
    .values(input)
    .onConflictDoUpdate({
      target: [goalProgress.goalId, goalProgress.period],
      set: {
        actualCents: sql`excluded.actual_cents`,
        targetCents: sql`excluded.target_cents`,
        onTrack: sql`excluded.on_track`,
        notes: sql`excluded.notes`,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('upsertGoalProgress: no row returned');
  return row;
}

/**
 * Return all goal_progress rows for a goal, ordered by period descending.
 */
export async function getGoalProgressByGoalId(goalId: GoalId): Promise<GoalProgressRow[]> {
  return db
    .select()
    .from(goalProgress)
    .where(eq(goalProgress.goalId, goalId))
    .orderBy(desc(goalProgress.period));
}

/**
 * Return the goal_progress row for a specific goal and calendar period.
 * Returns undefined if not yet computed.
 */
export async function getGoalProgressForPeriod(
  goalId: GoalId,
  period: string,
): Promise<GoalProgressRow | undefined> {
  const rows = await db
    .select()
    .from(goalProgress)
    .where(and(eq(goalProgress.goalId, goalId), eq(goalProgress.period, period)))
    .limit(1);
  return rows[0];
}

/**
 * Return the most recent goal_progress row for a goal (latest period).
 */
export async function getLatestGoalProgress(
  goalId: GoalId,
): Promise<GoalProgressRow | undefined> {
  const rows = await db
    .select()
    .from(goalProgress)
    .where(eq(goalProgress.goalId, goalId))
    .orderBy(desc(goalProgress.period))
    .limit(1);
  return rows[0];
}

export type { GoalProgressId };
