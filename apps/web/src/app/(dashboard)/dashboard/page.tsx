import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth-helpers';
import { getLatestNetWorthSnapshot, getNetWorthSeries } from '@/db/queries/net-worth';
import { getAssetBreakdown } from '@/db/queries/assets';
import { getActiveGoalsByUserId } from '@/db/queries/goals';
import { getLatestGoalProgress } from '@/db/queries/goal-progress';
import { centsToNumber } from '@/shared/money';
import { NetWorthSummaryCard } from '@/components/net-worth/net-worth-summary-card';
import { NetWorthTrendChart } from '@/components/net-worth/net-worth-trend-chart';
import { AllocationDonut } from '@/components/net-worth/allocation-donut';
import { DebtRatioChip } from '@/components/net-worth/debt-ratio-chip';
import { NetWorthEmptyState } from '@/components/net-worth/empty-state';
import { GoalProgressWidget } from '@/components/goals/goal-progress-widget';
import type { TrendPoint } from '@/components/net-worth/net-worth-trend-chart';
import type { AllocationSlice } from '@/components/net-worth/allocation-donut';
import type { GoalWithLatestProgress } from '@/components/goals/goal-progress-widget';
import type { GoalId } from '@/shared/types';

const KIND_LABELS: Record<string, string> = {
  home: 'Home',
  vehicle: 'Vehicles',
  brokerage: 'Brokerage',
  cash: 'Cash',
  crypto: 'Crypto',
  manual: 'Manual',
};

export default async function DashboardPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/sign-in');

  const [latestSnapshot, series30d, series90d, series1y, breakdown, activeGoals] =
    await Promise.all([
      getLatestNetWorthSnapshot(userId),
      getNetWorthSeries(userId, '30d'),
      getNetWorthSeries(userId, '90d'),
      getNetWorthSeries(userId, '1y'),
      getAssetBreakdown(userId),
      getActiveGoalsByUserId(userId),
    ]);

  // Fetch latest progress for each active goal in parallel.
  const progressRows = await Promise.all(
    activeGoals.map((g) => getLatestGoalProgress(g.id as GoalId)),
  );
  const goalsWithProgress: GoalWithLatestProgress[] = activeGoals.map((goal, i) => ({
    goal,
    progress: progressRows[i],
  }));

  const hasData = latestSnapshot != null || breakdown.length > 0;

  if (!hasData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Net Worth</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Your financial overview — assets, liabilities, and net worth over time.
          </p>
        </div>
        <NetWorthEmptyState />
        <GoalProgressWidget goalsWithProgress={goalsWithProgress} />
      </div>
    );
  }

  const netWorthCents = latestSnapshot
    ? latestSnapshot.assetsCents - latestSnapshot.liabilitiesCents
    : 0n;

  const previousCents =
    series30d.length > 1
      ? (series30d[0]?.assetsCents ?? 0n) - (series30d[0]?.liabilitiesCents ?? 0n)
      : null;

  const toTrendPoints = (series: typeof series30d): TrendPoint[] =>
    series.map((p) => ({
      date: p.date,
      valueDollars: centsToNumber(p.netWorthCents),
    }));

  const allocationSlices: AllocationSlice[] = breakdown.map((b) => ({
    kind: b.kind,
    valueDollars: centsToNumber(b.totalCents),
    label: KIND_LABELS[b.kind] ?? b.kind,
  }));

  const assetsCents = latestSnapshot?.assetsCents ?? 0n;
  const liabilitiesCents = latestSnapshot?.liabilitiesCents ?? 0n;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Net Worth</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          Your financial overview
          <DebtRatioChip assetsCents={assetsCents} liabilitiesCents={liabilitiesCents} />
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <NetWorthSummaryCard netWorthCents={netWorthCents} previousCents={previousCents} />
        <NetWorthTrendChart
          data30d={toTrendPoints(series30d)}
          data90d={toTrendPoints(series90d)}
          data1y={toTrendPoints(series1y)}
        />
      </div>

      <AllocationDonut slices={allocationSlices} />

      <GoalProgressWidget goalsWithProgress={goalsWithProgress} />
    </div>
  );
}

