import { LiabilityRowCard } from './liability-row';
import type { LiabilityRow } from '@/db/queries/liabilities';

interface LiabilityListProps {
  liabilities: readonly LiabilityRow[];
}

/** RSC — list of liability row cards. */
export function LiabilityList({ liabilities }: LiabilityListProps) {
  return (
    <div className="space-y-3">
      {liabilities.map((l) => (
        <LiabilityRowCard key={l.id} liability={l} />
      ))}
    </div>
  );
}
