import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/shared/money';

interface DebtSummaryCardProps {
  /** Total outstanding balance across all liabilities, in cents. */
  totalBalanceCents: bigint;
  /**
   * Floor estimate of total monthly minimums (balance × APR / 12, summed).
   * Null when no APR data is available.
   */
  estimatedMonthlyMinimumCents: bigint | null;
}

/** RSC — summary card showing total debt and estimated monthly obligation. */
export function DebtSummaryCard({
  totalBalanceCents,
  estimatedMonthlyMinimumCents,
}: DebtSummaryCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Total Debt</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-3xl font-bold tracking-tight text-red-600 dark:text-red-400">
          {formatCents(totalBalanceCents)}
        </p>
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Est. Monthly Minimum</dt>
            <dd className="font-medium">
              {estimatedMonthlyMinimumCents != null
                ? formatCents(estimatedMonthlyMinimumCents)
                : '—'}
            </dd>
          </div>
          {estimatedMonthlyMinimumCents == null && (
            <p className="col-span-full text-xs text-muted-foreground">
              Add APR to liabilities to see estimated minimums.
            </p>
          )}
        </dl>
      </CardContent>
    </Card>
  );
}
