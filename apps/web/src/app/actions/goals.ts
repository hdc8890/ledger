'use server';

import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { findUserByClerkId } from '@/db/queries/users';
import { getGoalById, archiveGoal, updateGoal } from '@/db/queries/goals';
import { insertAuditEvent } from '@/db/queries/audit-events';
import type { GoalId, UserId } from '@/shared/types';

export type ActionResult = { error?: string };

/**
 * Archive a goal. Soft status change — the row is retained for history.
 */
export async function archiveGoalAction(goalId: string): Promise<ActionResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return { error: 'Unauthorized' };

  const user = await findUserByClerkId(clerkId);
  if (!user) return { error: 'User not found' };

  const goal = await getGoalById(goalId as GoalId);
  if (!goal) return { error: 'Goal not found' };
  if (goal.userId !== user.id) return { error: 'Forbidden' };
  if (goal.status === 'archived') return { error: 'Goal is already archived' };

  await archiveGoal(goalId as GoalId, user.id as UserId);

  await insertAuditEvent({
    actor: clerkId,
    action: 'goal.archive',
    entityType: 'goal',
    entityId: goal.id,
    before: { status: goal.status },
    after: { status: 'archived' },
    source: 'user',
    confidence: 1.0,
  });

  revalidatePath('/goals');
  return {};
}

/**
 * Update a goal's name and/or priority.
 */
export async function updateGoalAction(
  goalId: string,
  patch: { name?: string; priority?: number },
): Promise<ActionResult> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return { error: 'Unauthorized' };

  const user = await findUserByClerkId(clerkId);
  if (!user) return { error: 'User not found' };

  const goal = await getGoalById(goalId as GoalId);
  if (!goal) return { error: 'Goal not found' };
  if (goal.userId !== user.id) return { error: 'Forbidden' };
  if (goal.status === 'archived') return { error: 'Cannot edit an archived goal' };

  if (!patch.name && patch.priority === undefined) return { error: 'No changes provided' };

  const updated = await updateGoal(goalId as GoalId, {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.priority !== undefined && { priority: patch.priority }),
  });

  await insertAuditEvent({
    actor: clerkId,
    action: 'goal.update',
    entityType: 'goal',
    entityId: goal.id,
    before: { name: goal.name, priority: goal.priority },
    after: { name: updated.name, priority: updated.priority },
    source: 'user',
    confidence: 1.0,
  });

  revalidatePath('/goals');
  return {};
}
