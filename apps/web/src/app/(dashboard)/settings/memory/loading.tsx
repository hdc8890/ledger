export default function MemoryLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="h-4 w-20 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-8 w-40 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-4 w-96 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900"
          />
        ))}
      </div>
    </div>
  );
}
