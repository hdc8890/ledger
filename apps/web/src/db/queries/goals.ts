import { eq, and, desc } from 'drizzle-orm';
import { db } from '@/lib/db';
import { goals } from '@/db/schema';
import type { GoalId, UserId } from '@/shared/types';

export type GoalRow = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;

/**
 * Insert a new goal row. Called by the approval server action after a
 * `goal_create` pending_change is approved.
 */
export async function insertGoal(input: NewGoal): Promise<GoalRow> {
  const rows = await db.insert(goals).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('insertGoal: no row returned');
  return row;
}

/**
 * Fetch all non-archived goals for a user, ordered by priority desc then created_at desc.
 */
export async function getGoalsByUserId(userId: UserId): Promise<GoalRow[]> {
  return db
    .select()
    .from(goals)
    .where(eq(goals.userId, userId))
    .orderBy(desc(goals.priority), desc(goals.createdAt));
}

/**
 * Fetch goals with status='active' for a user, ordered by priority desc then created_at desc.
 * Used by the progress tracking job to scope work to actionable goals only.
 */
export async function getActiveGoalsByUserId(userId: UserId): Promise<GoalRow[]> {
  return db
    .select()
    .from(goals)
    .where(and(eq(goals.userId, userId), eq(goals.status, 'active')))
    .orderBy(desc(goals.priority), desc(goals.createdAt));
}

/**
 * Fetch a single goal by ID. Returns undefined if not found.
 */
export async function getGoalById(id: GoalId): Promise<GoalRow | undefined> {
  const rows = await db.select().from(goals).where(eq(goals.id, id)).limit(1);
  return rows[0];
}

/**
 * Update a goal's mutable fields (name, priority, targetDate, targetAmountCents, constraints).
 */
export async function updateGoal(
  id: GoalId,
  patch: Partial<Pick<GoalRow, 'name' | 'priority' | 'targetDate' | 'targetAmountCents' | 'constraints' | 'status'>>,
): Promise<GoalRow> {
  const rows = await db
    .update(goals)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(goals.id, id))
    .returning();
  const row = rows[0];
  if (!row) throw new Error('updateGoal: no row returned');
  return row;
}

/**
 * Archive a goal (soft-status change). The goal row is retained for history.
 */
export async function archiveGoal(id: GoalId, userId: UserId): Promise<void> {
  await db
    .update(goals)
    .set({ status: 'archived', updatedAt: new Date() })
    .where(and(eq(goals.id, id), eq(goals.userId, userId)));
}
