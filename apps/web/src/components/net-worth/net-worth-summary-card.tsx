import { TrendingDown, TrendingUp } from 'lucide-react';
import { formatCents } from '@/shared/money';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface NetWorthSummaryCardProps {
  /** Current net worth in cents. */
  netWorthCents: bigint;
  /** Net worth from 30 days ago in cents. Null if no history. */
  previousCents: bigint | null;
}

/** RSC — displays total net worth and the delta vs the start of the period. */
export function NetWorthSummaryCard({ netWorthCents, previousCents }: NetWorthSummaryCardProps) {
  const delta = previousCents != null ? netWorthCents - previousCents : null;
  const positive = delta == null || delta >= 0n;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Net Worth</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-3xl font-bold tracking-tight">{formatCents(netWorthCents)}</p>
        {delta != null && (
          <div
            className={`flex items-center gap-1 text-sm font-medium ${
              positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
            }`}
          >
            {positive ? (
              <TrendingUp className="h-4 w-4" aria-hidden />
            ) : (
              <TrendingDown className="h-4 w-4" aria-hidden />
            )}
            <span>
              {positive ? '+' : ''}
              {formatCents(delta)} vs 30d ago
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
