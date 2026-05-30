'use server';

import { getCurrentUserId } from '@/lib/auth-helpers';
import {
  getProposalById,
  updateProposalStatus,
  listPendingProposals,
} from '@/db/queries/memories';
import { saveMemory } from '@/ai/memory';
import type { MemoryProposalId } from '@/shared/types';
import type { MemoryKind } from '@/db/queries/memories';
import type { MemoryProposalRow } from '@/db/queries/memories';

export type ProposalActionResult = { error?: string };

// ---------------------------------------------------------------------------
// acceptProposalAction
// ---------------------------------------------------------------------------

/**
 * Accept a pending memory proposal. Marks it accepted and persists the
 * memory with an embedding via saveMemory (which also writes an audit event).
 *
 * Ownership is enforced: only the owning user can accept their proposals.
 */
export async function acceptProposalAction(
  proposalId: string,
): Promise<ProposalActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: 'Unauthorized' };

  const proposal = await getProposalById(proposalId as MemoryProposalId);
  if (!proposal) return { error: 'Proposal not found' };
  if (proposal.userId !== userId) return { error: 'Forbidden' };
  if (proposal.status !== 'pending') return { error: 'Proposal already resolved' };

  try {
    // saveMemory computes the embedding and writes an audit event.
    await saveMemory(
      userId,
      proposal.proposedKind as MemoryKind,
      proposal.proposedText,
      proposal.sourceSessionId != null
        ? { source_session_id: proposal.sourceSessionId }
        : undefined,
      0.8, // auto-extracted memories start at 0.8 confidence; user just confirmed
    );

    await updateProposalStatus(proposalId as MemoryProposalId, userId, 'accepted');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to save memory';
    return { error: message };
  }

  return {};
}

// ---------------------------------------------------------------------------
// dismissProposalAction
// ---------------------------------------------------------------------------

/**
 * Dismiss a pending memory proposal. Marks it rejected without creating a
 * memory. Rejected proposals are retained to prevent the same content from
 * being re-proposed (see hasRejectedProposalWithText in the extraction job).
 */
export async function dismissProposalAction(
  proposalId: string,
): Promise<ProposalActionResult> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: 'Unauthorized' };

  const proposal = await getProposalById(proposalId as MemoryProposalId);
  if (!proposal) return { error: 'Proposal not found' };
  if (proposal.userId !== userId) return { error: 'Forbidden' };
  if (proposal.status !== 'pending') return { error: 'Proposal already resolved' };

  await updateProposalStatus(proposalId as MemoryProposalId, userId, 'rejected');
  return {};
}

// ---------------------------------------------------------------------------
// getPendingProposalsAction
// ---------------------------------------------------------------------------

/**
 * Fetch all pending memory proposals for the authenticated user.
 * Called by the chat UI after each turn to check for newly created proposals.
 */
export async function getPendingProposalsAction(): Promise<{
  proposals?: MemoryProposalRow[];
  error?: string;
}> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: 'Unauthorized' };

  const proposals = await listPendingProposals(userId);
  return { proposals };
}
