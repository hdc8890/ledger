import { TrendingDown, TrendingUp } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/shared/money';
import { ConfidenceChip } from './confidence-chip';
import { ManualOverrideBadge } from './manual-override-badge';
import type { AssetRow } from '@/db/queries/assets';

interface AssetKindCardProps {
  /** Display label for this asset kind. */
  label: string;
  /** Total current value across all assets of this kind, in cents. */
  totalCents: bigint;
  /** Delta vs ~30 days ago in cents. Null if no historical snapshot. */
  delta30dCents: bigint | null;
  /** Delta vs ~1 year ago in cents. Null if no historical snapshot. */
  delta1yCents: bigint | null;
  /** Individual asset rows for this kind. */
  assets: readonly AssetRow[];
}

function DeltaChip({ deltaCents, label }: { deltaCents: bigint; label: string }) {
  const positive = deltaCents >= 0n;
  const Icon = positive ? TrendingUp : TrendingDown;
  const colour = positive
    ? 'text-emerald-600 dark:text-emerald-400'
    : 'text-red-600 dark:text-red-400';

  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${colour}`}>
      <Icon className="h-3 w-3" aria-hidden />
      {positive ? '+' : ''}
      {formatCents(deltaCents)} {label}
    </span>
  );
}

/** RSC — card for a single asset kind showing total value and individual assets. */
export function AssetKindCard({
  label,
  totalCents,
  delta30dCents,
  delta1yCents,
  assets,
}: AssetKindCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <p className="text-2xl font-bold tracking-tight">{formatCents(totalCents)}</p>
        {(delta30dCents != null || delta1yCents != null) && (
          <div className="flex flex-wrap gap-2 pt-1">
            {delta30dCents != null && (
              <DeltaChip deltaCents={delta30dCents} label="30d" />
            )}
            {delta1yCents != null && (
              <DeltaChip deltaCents={delta1yCents} label="1y" />
            )}
          </div>
        )}
      </CardHeader>

      {assets.length > 0 && (
        <CardContent className="space-y-2 pt-0">
          <div className="h-px bg-neutral-100 dark:bg-neutral-800" />
          {assets.map((asset) => (
            <div key={asset.id} className="flex items-start justify-between gap-2 text-sm">
              <div className="flex flex-col gap-1">
                <span className="font-medium leading-tight">{asset.name}</span>
                <div className="flex flex-wrap gap-1">
                  {asset.manualOverride && <ManualOverrideBadge />}
                  {asset.confidence < 0.8 && (
                    <ConfidenceChip confidence={asset.confidence} />
                  )}
                </div>
              </div>
              <span className="shrink-0 font-medium">{formatCents(asset.valueCents)}</span>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}
