import Link from 'next/link';
import type { BudgetWithActual } from '@/db/queries/budgets';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDollars(cents: bigint): string {
  return `$${(Number(cents) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function pctUsed(actualCents: bigint, capCents: bigint): number {
  if (capCents <= 0n) return 0;
  return Number((actualCents * 10000n) / capCents) / 100;
}

// ---------------------------------------------------------------------------
// BudgetRow
// ---------------------------------------------------------------------------

interface BudgetRowProps {
  readonly budget: BudgetWithActual;
  /** Calendar days remaining in the current month (0 on the last day). */
  readonly daysRemainingInMonth: number;
}

/**
 * A single row on the /budgets page.
 * Shows category name, actual/cap amounts, a color-coded progress bar, and
 * an overrun message when the category exceeds its cap.
 *
 * Color rules:
 *   < 80%   → green
 *   80–100% → amber
 *   > 100%  → red
 */
export function BudgetRow({ budget, daysRemainingInMonth }: BudgetRowProps) {
  const pct = pctUsed(budget.actualCents, budget.capCents);
  const clampedPct = Math.min(pct, 100);
  const isOver = pct > 100;
  const isWarning = pct >= 80 && pct <= 100;

  const barColor = isOver
    ? 'bg-red-500'
    : isWarning
      ? 'bg-amber-400'
      : 'bg-emerald-500';

  const amountColor = isOver
    ? 'text-red-600 dark:text-red-400'
    : isWarning
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-neutral-700 dark:text-neutral-300';

  const overrunCents =
    budget.actualCents > budget.capCents ? budget.actualCents - budget.capCents : 0n;

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      {/* Header row: category + amounts */}
      <div className="flex items-baseline justify-between gap-4">
        <Link
          href={`/transactions`}
          className="truncate text-sm font-medium text-neutral-900 hover:underline dark:text-neutral-100"
          aria-label={`View ${budget.category} transactions`}
        >
          {budget.category}
        </Link>
        <span className={`shrink-0 tabular-nums text-sm font-semibold ${amountColor}`}>
          {formatDollars(budget.actualCents)}{' '}
          <span className="font-normal text-neutral-400 dark:text-neutral-500">
            / {formatDollars(budget.capCents)}
          </span>
        </span>
      </div>

      {/* Progress bar */}
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${budget.category} budget: ${Math.round(pct)}% used`}
      >
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${clampedPct}%` }}
        />
      </div>

      {/* Overrun message */}
      {isOver && (
        <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">
          {formatDollars(overrunCents)} over budget
          {daysRemainingInMonth > 0 && (
            <> — {daysRemainingInMonth} day{daysRemainingInMonth !== 1 ? 's' : ''} left</>
          )}
        </p>
      )}

      {/* Manual override indicator */}
      {budget.manualOverride && (
        <p className="mt-1 text-xs text-neutral-400 dark:text-neutral-500">
          Manually set cap
        </p>
      )}
    </div>
  );
}
