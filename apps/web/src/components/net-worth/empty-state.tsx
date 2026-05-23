import Link from 'next/link';

/** RSC — shown on the Net Worth dashboard when no data is available. */
export function NetWorthEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-neutral-300 py-16 text-center dark:border-neutral-700">
      <div className="text-4xl">📊</div>
      <h2 className="mt-4 text-lg font-semibold text-neutral-900 dark:text-neutral-100">
        No net worth data yet
      </h2>
      <p className="mt-2 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
        Connect your bank accounts or add manual assets to start tracking your net worth.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/connect"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Connect a bank
        </Link>
        <Link
          href="/assets"
          className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
        >
          Add an asset
        </Link>
      </div>
    </div>
  );
}
