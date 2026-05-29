import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth-helpers';
import { getBudgetsWithActuals } from '@/db/queries/budgets';
import { BudgetRow } from '@/components/budgets/budget-row';

export const metadata = { title: 'Budgets' };

export default async function BudgetsPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/sign-in');

  const now = new Date();
  const period = `${now.getUTCFullYear().toString()}-${(now.getUTCMonth() + 1).toString().padStart(2, '0')}-01`;

  const budgets = await getBudgetsWithActuals(userId, period);

  // Days remaining in the current calendar month (0 on the last day).
  const daysInMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const daysRemainingInMonth = Math.max(0, daysInMonth - now.getUTCDate());

  // Split into over-budget and within-budget for visual grouping.
  const overBudget = budgets.filter((b) => b.actualCents > b.capCents);
  const onTrack = budgets.filter((b) => b.actualCents <= b.capCents);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Budgets</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          This month&apos;s spending against your budget caps.
        </p>
      </div>

      {budgets.length === 0 && (
        <div className="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-900">
          <p className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            No budgets for this month
          </p>
          <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
            Ask the AI to create a plan from a goal, e.g. &ldquo;Propose a plan for my savings
            goal&rdquo;. Approve the plan to generate monthly budget caps.
          </p>
        </div>
      )}

      {overBudget.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-red-600 dark:text-red-400">
            Over budget
          </h2>
          {overBudget.map((budget) => (
            <BudgetRow
              key={budget.id}
              budget={budget}
              daysRemainingInMonth={daysRemainingInMonth}
            />
          ))}
        </section>
      )}

      {onTrack.length > 0 && (
        <section className="space-y-3">
          {overBudget.length > 0 && (
            <h2 className="text-base font-semibold text-neutral-800 dark:text-neutral-200">
              On track
            </h2>
          )}
          {onTrack.map((budget) => (
            <BudgetRow
              key={budget.id}
              budget={budget}
              daysRemainingInMonth={daysRemainingInMonth}
            />
          ))}
        </section>
      )}
    </div>
  );
}
