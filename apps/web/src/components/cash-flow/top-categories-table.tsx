import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/shared/money';
import type { SpendingByCategory } from '@/db/queries/cash-flow';

interface TopCategoriesTableProps {
  /** Top spending categories for the current month (descending by total). */
  currentCategories: readonly SpendingByCategory[];
  /** Top spending categories for the previous month, used for comparison. */
  previousCategories: readonly SpendingByCategory[];
  /** Display label for the current month, e.g. "May 2025". */
  currentMonthLabel: string;
}

/** RSC — top-5 spending categories with prior-month comparison. */
export function TopCategoriesTable({
  currentCategories,
  previousCategories,
  currentMonthLabel,
}: TopCategoriesTableProps) {
  const prevMap = new Map(previousCategories.map((c) => [c.category, c.totalCents]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Top Spending — {currentMonthLabel}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {currentCategories.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No spending recorded this month
          </p>
        ) : (
          <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
            {currentCategories.map((cat) => {
              const prevCents = prevMap.get(cat.category) ?? null;
              const delta = prevCents != null ? cat.totalCents - prevCents : null;
              const up = delta != null && delta > 0n;
              const down = delta != null && delta < 0n;

              return (
                <li
                  key={cat.category}
                  className="flex items-center justify-between gap-4 py-2 text-sm"
                >
                  <span className="font-medium text-neutral-800 dark:text-neutral-200">
                    {cat.category}
                  </span>
                  <div className="flex items-center gap-3">
                    {delta != null && (
                      <span
                        className={`flex items-center gap-0.5 text-xs ${
                          up
                            ? 'text-red-600 dark:text-red-400'
                            : down
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-muted-foreground'
                        }`}
                        title={`vs ${formatCents(prevCents ?? 0n)} last month`}
                      >
                        {up ? (
                          <TrendingUp className="h-3 w-3" aria-hidden />
                        ) : down ? (
                          <TrendingDown className="h-3 w-3" aria-hidden />
                        ) : (
                          <Minus className="h-3 w-3" aria-hidden />
                        )}
                        {up ? '+' : ''}
                        {formatCents(delta)}
                      </span>
                    )}
                    <span className="w-20 text-right font-semibold tabular-nums">
                      {formatCents(cat.totalCents)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
