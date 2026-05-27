'use client';

import { useState } from 'react';
import { acceptProposalAction, dismissProposalAction } from '@/app/actions/memory-proposals';
import type { MemoryProposalRow } from '@/db/queries/memories';

type ChipStatus = 'pending' | 'accepted' | 'dismissed' | 'error';

interface MemoryProposalChipProps {
  proposal: MemoryProposalRow;
  /** Called after the chip is accepted or dismissed so the parent can remove it. */
  onResolved: (proposalId: string) => void;
}

/**
 * MemoryProposalChip — "Remember: X?" prompt that appears in the chat UI after
 * a turn when the auto-extraction job proposes a new memory.
 *
 * Accept → saves the memory with embedding; Dismiss → marks it rejected (won't
 * be re-proposed).
 */
export function MemoryProposalChip({ proposal, onResolved }: MemoryProposalChipProps) {
  const [status, setStatus] = useState<ChipStatus>('pending');
  const [loading, setLoading] = useState(false);

  async function handleAccept() {
    setLoading(true);
    const res = await acceptProposalAction(proposal.id);
    setLoading(false);
    if (res.error) {
      setStatus('error');
    } else {
      setStatus('accepted');
      // Small delay so the user sees the confirmation before removal.
      setTimeout(() => onResolved(proposal.id), 1200);
    }
  }

  async function handleDismiss() {
    setLoading(true);
    const res = await dismissProposalAction(proposal.id);
    setLoading(false);
    if (res.error) {
      setStatus('error');
    } else {
      setStatus('dismissed');
      setTimeout(() => onResolved(proposal.id), 600);
    }
  }

  return (
    <div
      role="region"
      aria-label="Memory proposal"
      className="flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm dark:border-indigo-800 dark:bg-indigo-950/40"
    >
      {/* Brain icon */}
      <span className="mt-0.5 shrink-0 text-indigo-500 dark:text-indigo-400" aria-hidden>
        🧠
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
          Remember this?
        </p>
        <p className="mt-0.5 break-words text-neutral-700 dark:text-neutral-300">
          {proposal.proposedText}
        </p>
      </div>

      {status === 'pending' && (
        <div className="flex shrink-0 gap-2">
          <button
            onClick={() => void handleAccept()}
            disabled={loading}
            aria-label="Accept memory"
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? '…' : 'Save'}
          </button>
          <button
            onClick={() => void handleDismiss()}
            disabled={loading}
            aria-label="Dismiss memory"
            className="rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-700 dark:bg-transparent dark:text-indigo-300 dark:hover:bg-indigo-900/20"
          >
            {loading ? '…' : 'Dismiss'}
          </button>
        </div>
      )}

      {status === 'accepted' && (
        <p className="shrink-0 text-xs font-semibold text-green-600 dark:text-green-400">
          ✓ Saved
        </p>
      )}
      {status === 'dismissed' && (
        <p className="shrink-0 text-xs font-semibold text-neutral-400">✗ Dismissed</p>
      )}
      {status === 'error' && (
        <p className="shrink-0 text-xs font-semibold text-red-600 dark:text-red-400">Error</p>
      )}
    </div>
  );
}
