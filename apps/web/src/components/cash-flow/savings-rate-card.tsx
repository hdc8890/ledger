import { TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/shared/money';

interface SavingsRateCardProps {
  /** Current month income in cents. */
  incomeCents: bigint;
  /** Current month spending in cents. */
  spendingCents: bigint;
  /** Savings in cents (income − spending). */
  savingsCents: bigint;
}

/** RSC — savings rate percentage card for the current month. */
export function SavingsRateCard({ incomeCents, spendingCents, savingsCents }: SavingsRateCardProps) {
  const rate =
    incomeCents > 0n
      ? Math.round((Number(savingsCents) / Number(incomeCents)) * 100)
      : null;

  const positive = savingsCents >= 0n;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Savings Rate
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-2">
          {rate != null ? (
            <>
              <span className="text-3xl font-bold tracking-tight">{rate}%</span>
              {positive ? (
                <TrendingUp
                  className="mb-1 h-5 w-5 text-emerald-600 dark:text-emerald-400"
                  aria-hidden
                />
              ) : (
                <TrendingDown
                  className="mb-1 h-5 w-5 text-red-600 dark:text-red-400"
                  aria-hidden
                />
              )}
            </>
          ) : (
            <span className="text-3xl font-bold tracking-tight text-muted-foreground">—</span>
          )}
        </div>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Income</dt>
            <dd className="font-medium text-emerald-600 dark:text-emerald-400">
              {formatCents(incomeCents)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Spending</dt>
            <dd className="font-medium text-red-600 dark:text-red-400">
              {formatCents(spendingCents)}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
