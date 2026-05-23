interface DebtRatioChipProps {
  /** Total assets in cents. */
  assetsCents: bigint;
  /** Total liabilities in cents. */
  liabilitiesCents: bigint;
}

/**
 * RSC — displays the debt-to-asset ratio as a colour-coded pill.
 * < 30% → green (healthy), 30–60% → amber (watch), > 60% → red (high).
 */
export function DebtRatioChip({ assetsCents, liabilitiesCents }: DebtRatioChipProps) {
  if (assetsCents <= 0n) return null;

  // Compute ratio as integer basis points (avoids float division on BigInt).
  const ratioBps = Number((liabilitiesCents * 10000n) / assetsCents);
  const pct = ratioBps / 100;
  const label = `${pct.toFixed(1)}% debt-to-asset`;

  const colour =
    pct < 30
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
      : pct < 60
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
        : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300';

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${colour}`}>
      {label}
    </span>
  );
}
