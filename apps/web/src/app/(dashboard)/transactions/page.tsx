import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { findUserByClerkId } from '@/db/queries/users';
import { getTransactionsForListView } from '@/db/queries/transactions';
import { TransactionsTable } from '@/components/transactions/transactions-table';
import type { UserId } from '@/shared/types';

export default async function TransactionsPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const user = await findUserByClerkId(clerkId);
  if (!user) redirect('/sign-in');

  const userId = user.id as UserId;
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
