import { CategoryChip } from '@/components/transactions/category-chip';
import { formatCents } from '@/shared/money';
import type { TransactionListRow } from '@/db/queries/transactions';

interface TransactionsTableProps {
  transactions: readonly TransactionListRow[];
}

/**
 * TransactionsTable — RSC list of transactions with enrichment indicators.
 *
 * Each row shows:
 *   - Date, merchant (normalized or raw), account name
 *   - Amount (formatted, red for debits)
 *   - CategoryChip (client component) — category, source badge, one-click correction
 */
export function TransactionsTable({ transactions }: TransactionsTableProps) {
  if (transactions.length === 0) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white px-6 py-12 text-center dark:border-neutral-800 dark:bg-neutral-900">
        <p className="text-sm text-neutral-500 dark:text-neutral-400">No transactions found.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-xs font-medium uppercase tracking-wide text-neutral-400 dark:border-neutral-800 dark:text-neutral-500">
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Merchant</th>
            <th className="hidden px-4 py-3 md:table-cell">Account</th>
            <th className="px-4 py-3">Category</th>
            <th className="px-4 py-3 text-right">Amount</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
          {transactions.map((txn) => {
            const merchant = txn.merchantNormalized ?? txn.merchantRaw;
            const isDebit = txn.amountCents > 0n;
            const absAmount = txn.amountCents < 0n ? -txn.amountCents : txn.amountCents;

            return (
              <tr
                key={txn.id}
                className="transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
              >
                <td className="whitespace-nowrap px-4 py-3 tabular-nums text-neutral-500 dark:text-neutral-400">
                  {txn.postedAt}
                </td>
                <td className="px-4 py-3 font-medium text-neutral-800 dark:text-neutral-200">
                  {merchant}
                  {txn.isTransfer && (
                    <span className="ml-2 rounded-full bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
                      Transfer
                    </span>
                  )}
                </td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-neutral-500 dark:text-neutral-400 md:table-cell">
                  {txn.accountName}
                </td>
                <td className="px-4 py-3">
                  <CategoryChip
                    transactionId={txn.id}
                    category={txn.category}
                    categorySource={txn.categorySource}
                    categoryConfidence={txn.categoryConfidence}
                  />
                </td>
                <td
                  className={`whitespace-nowrap px-4 py-3 text-right tabular-nums font-medium ${
                    isDebit
                      ? 'text-red-600 dark:text-red-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {isDebit ? '' : '+'}
                  {formatCents(isDebit ? absAmount : -absAmount)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
