import { z } from 'zod';
import { summarizePeriod } from '@/db/queries/cash-flow';
import { centsToNumber } from '@/shared/money';
import type { ToolContext } from './context';

export const inputSchema = z.object({
  /** Start of the period, inclusive (YYYY-MM-DD). */
  startDate: z.string(),
  /** End of the period, inclusive (YYYY-MM-DD). */
  endDate: z.string(),
});

export const outputSchema = z.object({
  period: z.object({ start: z.string(), end: z.string() }),
  incomeDollars: z.number(),
  spendingDollars: z.number(),
  savingsDollars: z.number(),
  topSpendingCategories: z.array(
    z.object({ category: z.string(), totalDollars: z.number(), transactionCount: z.number() }),
  ),
  topMerchants: z.array(
    z.object({ merchant: z.string(), totalDollars: z.number(), transactionCount: z.number() }),
  ),
});

export type SummarizePeriodOutput = z.infer<typeof outputSchema>;

export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<SummarizePeriodOutput> {
  const summary = await summarizePeriod(ctx.userId, input.startDate, input.endDate);
  return {
    period: summary.period,
    incomeDollars: centsToNumber(summary.incomeCents),
    spendingDollars: centsToNumber(summary.spendingCents),
    savingsDollars: centsToNumber(summary.savingsCents),
    topSpendingCategories: summary.topSpendingCategories.map((c) => ({
      category: c.category,
      totalDollars: centsToNumber(c.totalCents),
      transactionCount: c.count,
    })),
    topMerchants: summary.topMerchants.map((m) => ({
      merchant: m.merchant,
      totalDollars: centsToNumber(m.totalCents),
      transactionCount: m.count,
    })),
  };
}
