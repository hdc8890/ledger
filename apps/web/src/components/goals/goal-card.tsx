'use client';

import { useState, useTransition } from 'react';
import { GoalStatusBadge } from './goal-status-badge';
import { archiveGoalAction } from '@/app/actions/goals';
import type { GoalRow } from '@/db/queries/goals';

const KIND_LABELS: Record<GoalRow['kind'], string> = {
  save_for: 'Save for',
  accelerate_debt: 'Accelerate debt payoff',
  reduce_category_spend: 'Reduce category spend',
  increase_savings_rate: 'Increase savings rate',
};

function formatDollars(cents: bigint): string {
  return `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDate(dateStr: string): string {
  // dateStr is "YYYY-MM-DD"
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface GoalCardProps {
  goal: GoalRow;
}

export function GoalCard({ goal }: GoalCardProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleArchive() {
    setError(null);
    startTransition(async () => {
      const result = await archiveGoalAction(goal.id);
      if (result.error) setError(result.error);
    });
  }

  const isArchivable = goal.status !== 'archived' && goal.status !== 'achieved';

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {goal.name}
            </h3>
            <GoalStatusBadge status={goal.status} />
          </div>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {KIND_LABELS[goal.kind]}
          </p>
          <div className="mt-2 flex flex-wrap gap-3">
            {goal.targetAmountCents !== null && (
              <div>
                <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
                  Target
                </span>
                <p className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                  {formatDollars(goal.targetAmountCents)}
                </p>
              </div>
            )}
            {goal.targetDate !== null && (
              <div>
                <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
                  By
                </span>
                <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                  {formatDate(goal.targetDate)}
                </p>
              </div>
            )}
            {goal.priority > 0 && (
              <div>
                <span className="text-xs font-medium text-neutral-400 dark:text-neutral-500">
                  Priority
                </span>
                <p className="text-sm font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                  {goal.priority}
                </p>
              </div>
            )}
          </div>
          {error && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
        </div>

        {isArchivable && (
          <button
            type="button"
            onClick={handleArchive}
            disabled={isPending}
            className="shrink-0 rounded-md px-3 py-1.5 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-50 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          >
            {isPending ? 'Archiving…' : 'Archive'}
          </button>
        )}
      </div>
    </div>
  );
}
