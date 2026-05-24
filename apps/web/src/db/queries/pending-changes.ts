import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { pendingChanges } from '@/db/schema';
import type { PendingChangeId, UserId } from '@/shared/types';

export type PendingChangeRow = typeof pendingChanges.$inferSelect;
export type NewPendingChange = typeof pendingChanges.$inferInsert;

/**
 * Insert a new pending change proposal. Called by write tools (Phase 3 Task 4).
 */
export async function insertPendingChange(
  input: NewPendingChange,
): Promise<PendingChangeRow> {
  const rows = await db.insert(pendingChanges).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('insertPendingChange: no row returned');
  return row;
}

/**
 * Fetch all pending (unapproved) changes for a user.
 */
export async function getPendingChangesByUserId(userId: UserId): Promise<PendingChangeRow[]> {
  return db
    .select()
    .from(pendingChanges)
    .where(eq(pendingChanges.userId, userId));
}

/**
 * Fetch a single pending change by ID. Returns undefined if not found.
 */
export async function getPendingChangeById(
  id: PendingChangeId,
): Promise<PendingChangeRow | undefined> {
  const rows = await db
    .select()
    .from(pendingChanges)
    .where(eq(pendingChanges.id, id))
    .limit(1);
  return rows[0];
}

/**
 * Mark a pending change as applied.
 */
export async function applyPendingChange(
  id: PendingChangeId,
  appliedAt: Date,
): Promise<void> {
  await db
    .update(pendingChanges)
    .set({ status: 'applied', appliedAt })
    .where(eq(pendingChanges.id, id));
}

/**
 * Mark a pending change as rejected.
 */
export async function rejectPendingChange(id: PendingChangeId): Promise<void> {
  await db
    .update(pendingChanges)
    .set({ status: 'rejected' })
    .where(eq(pendingChanges.id, id));
}
