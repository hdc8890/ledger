import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { findUserByClerkId } from '@/db/queries/users';
import { getLiabilitiesByUserId, getDebtSummary } from '@/db/queries/liabilities';
import { DebtSummaryCard } from '@/components/debt/debt-summary-card';
import { LiabilityList } from '@/components/debt/liability-list';
import { PayoffChart } from '@/components/debt/payoff-chart';
import { DebtEmptyState } from '@/components/debt/empty-state';
import type { UserId } from '@/shared/types';
import type { LiabilityPayoffInput } from '@/components/debt/payoff-chart';

export default async function DebtPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const user = await findUserByClerkId(clerkId);
  if (!user) redirect('/sign-in');

  const userId = user.id as UserId;

  const [liabilities, summary] = await Promise.all([
    getLiabilitiesByUserId(userId),
    getDebtSummary(userId),
  ]);

  if (liabilities.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Debt</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Loans, mortgages, credit cards, and payoff projections.
          </p>
        </div>
        <DebtEmptyState />
      </div>
    );
  }

  const payoffInputs: LiabilityPayoffInput[] = liabilities.map((l) => ({
    id: l.id,
    name: l.name,
    balanceCents: l.balanceCents,
    apr: l.apr ?? null,
    termMonths: l.termMonths ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Debt</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Loans, mortgages, credit cards, and payoff projections.
        </p>
      </div>

      <DebtSummaryCard
        totalBalanceCents={summary.totalBalanceCents}
        estimatedMonthlyMinimumCents={summary.estimatedMonthlyMinimumCents}
      />

      <PayoffChart liabilities={payoffInputs} />

      <div>
        <h2 className="mb-3 text-base font-semibold text-neutral-900 dark:text-neutral-100">
          All Liabilities
        </h2>
        <LiabilityList liabilities={liabilities} />
      </div>
    </div>
  );
}
