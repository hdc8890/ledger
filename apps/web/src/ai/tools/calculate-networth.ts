import { z } from 'zod';
import { getAssetBreakdown } from '@/db/queries/assets';
import { getDebtSummary } from '@/db/queries/liabilities';
import { getLatestNetWorthSnapshot } from '@/db/queries/net-worth';
import { centsToNumber } from '@/shared/money';
import type { ToolContext } from './context';

export const inputSchema = z.object({
  /**
   * Point-in-time date (YYYY-MM-DD). When provided and a snapshot exists for
   * that date, the snapshot values are used. Otherwise, current live data is
   * returned with a note.
   */
  asOf: z.string().optional(),
});

export const outputSchema = z.object({
  asOf: z.string(),
  totalAssetsDollars: z.number(),
  totalLiabilitiesDollars: z.number(),
  netWorthDollars: z.number(),
  byAssetKind: z.array(z.object({ kind: z.string(), totalDollars: z.number() })),
  byLiabilityKind: z.array(z.object({ kind: z.string(), totalDollars: z.number() })),
  note: z.string(),
});

export type CalculateNetworthOutput = z.infer<typeof outputSchema>;

export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<CalculateNetworthOutput> {
  const todayStr = new Date().toISOString().slice(0, 10) ?? '';
  const asOf = input.asOf ?? todayStr;

  // If a historical date is requested, try to serve from snapshot.
  if (input.asOf !== undefined && input.asOf !== todayStr) {
    const snapshot = await getLatestNetWorthSnapshot(ctx.userId);
    if (snapshot?.snapshotDate === input.asOf) {
      const breakdown = snapshot.breakdown as Record<string, string>;
      const byAssetKind = Object.entries(breakdown).map(([kind, val]) => ({
        kind,
        totalDollars: centsToNumber(BigInt(val)),
      }));
      const assetsCents = snapshot.assetsCents;
      const liabilitiesCents = snapshot.liabilitiesCents;
      return {
        asOf,
        totalAssetsDollars: centsToNumber(assetsCents),
        totalLiabilitiesDollars: centsToNumber(liabilitiesCents),
        netWorthDollars: centsToNumber(assetsCents - liabilitiesCents),
        byAssetKind,
        byLiabilityKind: [],
        note: `From snapshot dated ${snapshot.snapshotDate}`,
      };
    }
  }

  // Fall back to live calculation from current assets and liabilities.
  const [assetBreakdown, debtSummary] = await Promise.all([
    getAssetBreakdown(ctx.userId),
    getDebtSummary(ctx.userId),
  ]);

  const totalAssetsCents = assetBreakdown.reduce((s, a) => s + a.totalCents, 0n);
  const totalLiabilitiesCents = debtSummary.totalBalanceCents;

  return {
    asOf,
    totalAssetsDollars: centsToNumber(totalAssetsCents),
    totalLiabilitiesDollars: centsToNumber(totalLiabilitiesCents),
    netWorthDollars: centsToNumber(totalAssetsCents - totalLiabilitiesCents),
    byAssetKind: assetBreakdown.map((a) => ({
      kind: a.kind,
      totalDollars: centsToNumber(a.totalCents),
    })),
    byLiabilityKind: debtSummary.byKind.map((d) => ({
      kind: d.kind,
      totalDollars: centsToNumber(d.totalCents),
    })),
    note: 'Calculated from current assets and liabilities',
  };
}
