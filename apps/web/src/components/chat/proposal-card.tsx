'use client';

import { useState } from 'react';
import { approveChangeAction, rejectChangeAction } from '@/app/actions/pending-changes';
import type { UpdateAssetOutput } from '@/ai/tools/update-asset';
import type { TagTransactionOutput } from '@/ai/tools/tag-transaction';
import type { CreateRuleDraftOutput } from '@/ai/tools/create-rule-draft';

// ---------------------------------------------------------------------------
// Union of all write-tool outputs that carry a proposalId
// ---------------------------------------------------------------------------

type WriteToolResult = UpdateAssetOutput | TagTransactionOutput | CreateRuleDraftOutput;

type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'error';

interface ProposalCardProps {
  toolName: string;
  result: WriteToolResult;
}

/**
 * ProposalCard — renders a diff card for an AI write-tool proposal.
 *
 * Shown inline in the chat whenever the assistant calls update_asset,
 * tag_transaction, or create_rule_draft. The user must explicitly approve
 * or reject; no change is committed until approval.
 */
export function ProposalCard({ toolName, result }: ProposalCardProps) {
  const [status, setStatus] = useState<ProposalStatus>('pending');
  const [loading, setLoading] = useState(false);

  async function handleApprove() {
    setLoading(true);
    const res = await approveChangeAction(result.proposalId);
    setLoading(false);
    setStatus(res.error ? 'error' : 'approved');
  }

  async function handleReject() {
    setLoading(true);
    const res = await rejectChangeAction(result.proposalId);
    setLoading(false);
    setStatus(res.error ? 'error' : 'rejected');
  }

  return (
    <div
      role="region"
      aria-label="Proposal card"
      className="my-1 rounded-xl border border-neutral-200 bg-white p-4 text-sm shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
    >
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-400">
          Proposed change
        </span>
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {friendlyKind(toolName)}
        </span>
      </div>

      {/* Diff body */}
      <div className="mb-4 text-neutral-700 dark:text-neutral-300">
        <DiffBody toolName={toolName} result={result} />
      </div>

      {/* Action buttons / resolved state */}
      {status === 'pending' && (
        <div className="flex gap-2">
          <button
            onClick={() => void handleApprove()}
            disabled={loading}
            aria-label="Approve change"
            className="flex-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? 'Applying…' : 'Approve'}
          </button>
          <button
            onClick={() => void handleReject()}
            disabled={loading}
            aria-label="Reject change"
            className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-200 dark:hover:bg-neutral-700"
          >
            {loading ? '…' : 'Reject'}
          </button>
        </div>
      )}

      {status === 'approved' && (
        <p className="text-xs font-semibold text-green-600 dark:text-green-400">✓ Change applied</p>
      )}
      {status === 'rejected' && (
        <p className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">✗ Change rejected</p>
      )}
      {status === 'error' && (
        <p className="text-xs font-semibold text-red-600 dark:text-red-400">
          Something went wrong. Please try again.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function friendlyKind(toolName: string): string {
  if (toolName === 'update_asset') return 'Asset update';
  if (toolName === 'tag_transaction') return 'Transaction tag';
  if (toolName === 'create_rule_draft') return 'New rule';
  return toolName;
}

function DiffBody({ toolName, result }: { toolName: string; result: WriteToolResult }) {
  if (toolName === 'update_asset') {
    const r = result as UpdateAssetOutput;
    return (
      <div className="space-y-1.5">
        <p className="font-medium">{r.assetName}</p>
        {r.changes.valueDollars && (
          <DiffRow
            label="Value"
            from={`$${r.changes.valueDollars.from.toFixed(2)}`}
            to={`$${r.changes.valueDollars.to.toFixed(2)}`}
          />
        )}
        {r.changes.name && (
          <DiffRow label="Name" from={r.changes.name.from} to={r.changes.name.to} />
        )}
      </div>
    );
  }

  if (toolName === 'tag_transaction') {
    const r = result as TagTransactionOutput;
    return (
      <div className="space-y-1.5">
        <p className="font-medium">{r.merchantRaw}</p>
        <DiffRow label="Category" from={r.currentCategory ?? 'None'} to={r.proposedCategory} />
      </div>
    );
  }

  if (toolName === 'create_rule_draft') {
    const r = result as CreateRuleDraftOutput;
    const predicateParts: string[] = [];
    if (r.predicate.merchantContains !== undefined)
      predicateParts.push(`merchant contains "${r.predicate.merchantContains}"`);
    if (r.predicate.merchantExact !== undefined)
      predicateParts.push(`merchant is "${r.predicate.merchantExact}"`);
    if (r.predicate.category !== undefined)
      predicateParts.push(`category is "${r.predicate.category}"`);
    return (
      <div className="space-y-1.5">
        <p>
          <span className="font-medium">When: </span>
          {predicateParts.join(' AND ')}
        </p>
        <p>
          <span className="font-medium">Set category: </span>
          {r.setCategory}
        </p>
      </div>
    );
  }

  // Fallback: show the description string from any write tool output.
  return <p>{(result as { description: string }).description}</p>;
}

function DiffRow({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-20 shrink-0 text-neutral-500 dark:text-neutral-400">{label}</span>
      <span className="rounded bg-red-50 px-1.5 py-0.5 font-mono text-red-600 line-through dark:bg-red-900/20 dark:text-red-400">
        {from}
      </span>
      <span className="text-neutral-400">→</span>
      <span className="rounded bg-green-50 px-1.5 py-0.5 font-mono text-green-700 dark:bg-green-900/20 dark:text-green-400">
        {to}
      </span>
    </div>
  );
}
