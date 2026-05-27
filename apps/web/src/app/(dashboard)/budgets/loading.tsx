export default function BudgetsLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-28 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded-lg bg-neutral-200 dark:bg-neutral-800" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 animate-pulse rounded-xl bg-neutral-200 dark:bg-neutral-800"
          />
        ))}
      </div>
    </div>
  );
}
