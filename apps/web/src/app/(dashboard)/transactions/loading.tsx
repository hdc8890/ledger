export default function TransactionsLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-40 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="mt-2 h-4 w-80 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      </div>
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 border-b border-neutral-100 px-4 py-3 last:border-0 dark:border-neutral-800"
          >
            <div className="h-4 w-20 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-4 flex-1 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-5 w-28 animate-pulse rounded-full bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-4 w-16 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
