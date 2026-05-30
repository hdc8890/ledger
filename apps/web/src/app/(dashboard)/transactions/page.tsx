import { redirect } from 'next/navigation';
import { getCurrentUserId } from '@/lib/auth-helpers';
import { getTransactionsForListView } from '@/db/queries/transactions';
import { TransactionsTable } from '@/components/transactions/transactions-table';

export default async function TransactionsPage() {
  const userId = await getCurrentUserId();
  if (!userId) redirect('/sign-in');
  const transactions = await getTransactionsForListView(userId, { limit: 100 });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Transactions</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Recent transactions. Click a category to correct it — corrections create a rule and
          re-tag similar transactions automatically.
        </p>
      </div>

      <TransactionsTable transactions={transactions} />
    </div>
  );
}
