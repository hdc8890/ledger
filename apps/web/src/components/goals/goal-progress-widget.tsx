import Link from 'next/link';
import type { GoalRow } from '@/db/queries/goals';
import type { GoalProgressRow, GoalProgressNotes } from '@/db/queries/goal-progress';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GoalWithLatestProgress = {
  readonly goal: GoalRow;
  readonly progress: GoalProgressRow | undefined;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pctUsed(actual: bigint, target: bigint): number {
  if (target <= 0n) return 0;
  return Math.round(Number((actual * 100n) / target));
}

// ---------------------------------------------------------------------------
// GoalProgressWidget — RSC, no interactivity needed
// ---------------------------------------------------------------------------

interface GoalProgressWidgetProps {
  readonly goalsWithProgress: readonly GoalWithLatestProgress[];
}

/**
 * Compact goal-health summary card for the main dashboard.
 * Lists every active goal with its on-track status and a progress bar.
 *
 * Server Component — no 'use client' needed; data is passed as props from
 * the dashboard RSC page.
 */
export function GoalProgressWidget({ goalsWithProgress }: GoalProgressWidgetProps) {
  if (goalsWithProgress.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-neutral-300 bg-white p-6 dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">Goals</h2>
          <Link
            href="/goals"
            className="text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
          >
            Manage →
          </Link>
        </div>
        <p className="mt-3 text-sm text-neutral-500 dark:text-neutral-400">
          No active goals. Ask the AI to create one, e.g. &ldquo;Help me save an extra
          $1,500/month&rdquo;.
        </p>
      </section>
    );
  }

  const offTrackCount = goalsWithProgress.filter(
    ({ progress }) => progress?.onTrack === false,
  ).length;

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">Goals</h2>
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {goalsWithProgress.length} active
            {offTrackCount > 0 && (
              <span className="ml-1 font-medium text-red-500 dark:text-red-400">
                · {offTrackCount} need{offTrackCount === 1 ? 's' : ''} attention
              </span>
            )}
          </span>
        </div>
        <Link
          href="/goals"
          className="text-xs text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-300"
        >
          View all →
        </Link>
      </div>

      <div className="space-y-2">
        {goalsWithProgress.map(({ goal, progress }) => {
          const onTrack = progress?.onTrack ?? null;
          const pct =
            progress && progress.targetCents > 0n
              ? pctUsed(progress.actualCents, progress.targetCents)
              : null;
          const clampedPct = pct !== null ? Math.min(pct, 100) : null;

          // Safe: notes are written exclusively by the nightly tracking job
          // using the GoalProgressNotes shape in db/queries/goal-progress.ts.
          const notes = progress?.notes as GoalProgressNotes | null;
          const topAnomaly = notes?.anomalies?.[0];

          const barColor =
            onTrack === false
              ? 'bg-red-500'
              : onTrack === true
                ? 'bg-emerald-500'
                : 'bg-neutral-300 dark:bg-neutral-600';

          return (
            <div
              key={goal.id}
              className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
                  {goal.name}
                </span>

                {onTrack === true && (
                  <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                    On track
                  </span>
                )}
                {onTrack === false && (
                  <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                    Needs attention
                  </span>
                )}
                {onTrack === null && (
                  <span className="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                    No data yet
                  </span>
                )}
              </div>

              {clampedPct !== null && (
                <div
                  className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100 dark:bg-neutral-800"
                  role="progressbar"
                  aria-valuenow={clampedPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${goal.name}: ${clampedPct}% of target`}
                >
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${clampedPct}%` }}
                  />
                </div>
              )}

              {topAnomaly && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">{topAnomaly}</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
