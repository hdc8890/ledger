'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUserId } from '@/lib/auth-helpers';
import { deleteAllMemories } from '@/db/queries/memories';
import { insertAuditEvent } from '@/db/queries/audit-events';
import { deleteMemory, updateMemoryText, listMemories } from '@/ai/memory';
import type { MemoryId } from '@/shared/types';
import type { MemoryRow } from '@/db/queries/memories';

export type MemoryActionResult = { error?: string };

// ---------------------------------------------------------------------------
// updateMemoryAction
// ---------------------------------------------------------------------------

/**
 * Update the text of a user's memory. Recomputes the embedding via
 * text-embedding-3-small so similarity retrieval stays accurate.
 *
 * Validates ownership and enforces privacy rules (validateMemoryText
 * is called inside updateMemoryText).
 */
export async function updateMemoryAction(
  memoryId: string,
  newText: string,
): Promise<MemoryActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: 'Unauthorized' };

  const trimmed = newText.trim();
  if (!trimmed) return { error: 'Memory text cannot be empty' };

  try {
    const updated = await updateMemoryText(userId, memoryId as MemoryId, trimmed);
    if (!updated) return { error: 'Memory not found' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update memory';
    return { error: message };
  }

  revalidatePath('/settings/memory');
  return {};
}

// ---------------------------------------------------------------------------
// deleteMemoryAction
// ---------------------------------------------------------------------------

/**
 * Hard-delete a single memory by ID. Ownership is enforced by
 * deleteMemory (ai/memory.ts), which also writes an audit event.
 */
export async function deleteMemoryAction(memoryId: string): Promise<MemoryActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: 'Unauthorized' };

  try {
    await deleteMemory(userId, memoryId as MemoryId);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to delete memory';
    return { error: message };
  }

  revalidatePath('/settings/memory');
  return {};
}

// ---------------------------------------------------------------------------
// clearAllMemoriesAction
// ---------------------------------------------------------------------------

/**
 * Hard-delete ALL memories for the authenticated user.
 * This is a permanent, irreversible operation — callers must confirm
 * intent before invoking (e.g. via a client-side confirmation prompt).
 */
export async function clearAllMemoriesAction(): Promise<MemoryActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: 'Unauthorized' };

  try {
    // Count before deletion for the audit trail.
    const existing = await listMemories(userId, undefined, 1000, 0);
    await deleteAllMemories(userId);
    await insertAuditEvent({
      actor: userId,
      action: 'memory.bulk_delete',
      entityType: 'user',
      entityId: userId,
      before: { count: existing.length },
      after: null,
      source: 'user',
      confidence: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to clear memories';
    return { error: message };
  }

  revalidatePath('/settings/memory');
  return {};
}

// ---------------------------------------------------------------------------
// getMemoriesAction
// ---------------------------------------------------------------------------

/**
 * Fetch all memories for the authenticated user.
 * Used by the Memory management UI export button (client component
 * needs the data already loaded rather than re-fetching server-side).
 */
export async function getMemoriesAction(): Promise<{
  memories?: MemoryRow[];
  error?: string;
}> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: 'Unauthorized' };

  const memories = await listMemories(userId, undefined, 500, 0);
  return { memories };
}
