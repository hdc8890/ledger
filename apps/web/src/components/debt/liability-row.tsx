import { formatCents } from '@/shared/money';
import type { LiabilityRow } from '@/db/queries/liabilities';

const KIND_LABELS: Record<LiabilityRow['kind'], string> = {
  mortgage: 'Mortgage',
  auto: 'Auto Loan',
  personal: 'Personal Loan',
  student: 'Student Loan',
  credit_card: 'Credit Card',
  other: 'Other',
};

interface LiabilityRowCardProps {
  liability: LiabilityRow;
}

/** RSC — single row showing name, type, balance, and APR for one liability. */
export function LiabilityRowCard({ liability }: LiabilityRowCardProps) {
  const aprPercent =
    liability.apr != null ? `${(liability.apr * 100).toFixed(2)}%` : null;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">
          {liability.name}
        </p>
        <p className="text-xs text-muted-foreground">{KIND_LABELS[liability.kind]}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5">
        <span className="font-semibold text-red-600 dark:text-red-400">
          {formatCents(liability.balanceCents)}
        </span>
        {aprPercent != null && (
          <span className="text-xs text-muted-foreground">{aprPercent} APR</span>
        )}
      </div>
    </div>
  );
}
