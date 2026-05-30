import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth-helpers';
import { getCashFlowSeries } from '@/db/queries/cash-flow';
import { CashFlowBarChart } from '@/components/cash-flow/cash-flow-bar-chart';
import { SavingsRateCard } from '@/components/cash-flow/savings-rate-card';
import { TopCategoriesTable } from '@/components/cash-flow/top-categories-table';
import { CashFlowEmptyState } from '@/components/cash-flow/empty-state';

function formatMonthLabel(yearMonth: string): string {
  const [year, mon] = yearMonth.split('-');
  if (!year || !mon) return yearMonth;
  const d = new Date(Date.UTC(Number(year), Number(mon) - 1, 1));
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export default async function CashFlowPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/sign-in');

  // Fetch 6 months newest-first; reverse for chronological bar chart display.
  const seriesNewestFirst = await getCashFlowSeries(userId, 6);
  const seriesChronological = [...seriesNewestFirst].reverse();

  const currentMonth = seriesNewestFirst[0];
  const previousMonth = seriesNewestFirst[1];

  const hasData = seriesNewestFirst.some(
    (m) => m.incomeCents > 0n || m.spendingCents > 0n,
  );

  if (!hasData) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
            Cash Flow
          </h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Monthly income, spending, and savings breakdown.
          </p>
        </div>
        <CashFlowEmptyState />
      </div>
    );
  }

  const currentMonthLabel = currentMonth ? formatMonthLabel(currentMonth.month) : '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Cash Flow</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Monthly income, spending, and savings breakdown.
        </p>
      </div>

      {/* Savings rate summary for current month */}
      {currentMonth && (
        <SavingsRateCard
          incomeCents={currentMonth.incomeCents}
          spendingCents={currentMonth.spendingCents}
          savingsCents={currentMonth.savingsCents}
        />
      )}

      {/* Income vs Spending bar chart — 6 months chronological */}
      <CashFlowBarChart data={seriesChronological} />

      {/* Top categories this month vs last month */}
      {currentMonth && (
        <TopCategoriesTable
          currentCategories={currentMonth.topCategories}
          previousCategories={previousMonth?.topCategories ?? []}
          currentMonthLabel={currentMonthLabel}
        />
      )}
    </div>
  );
}
