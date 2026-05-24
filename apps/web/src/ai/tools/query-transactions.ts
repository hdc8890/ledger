import { z } from 'zod';
import { aggregateTransactions } from '@/db/queries/transactions';
import { centsToNumber } from '@/shared/money';
import type { ToolContext } from './context';

export const inputSchema = z.object({
  /** Dimension to group results by. */
  groupBy: z.enum(['category', 'merchant', 'month']),
  /** Start of the date range, inclusive (YYYY-MM-DD). */
  startDate: z.string(),
  /** End of the date range, inclusive (YYYY-MM-DD). */
  endDate: z.string(),
  /** Whether to include only spending, only income, or both. Defaults to 'spending'. */
  type: z.enum(['spending', 'income', 'all']).optional().default('spending'),
  /** Exclude internal transfers from results. Defaults to true. */
  excludeTransfers: z.boolean().optional().default(true),
});

export const outputSchema = z.object({
  groups: z.array(
    z.object({
      key: z.string(),
      totalDollars: z.number(),
      transactionCount: z.number(),
    }),
  ),
  grandTotalDollars: z.number(),
  dateRange: z.object({ start: z.string(), end: z.string() }),
});

export type QueryTransactionsOutput = z.infer<typeof outputSchema>;

export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<QueryTransactionsOutput> {
  const { groupBy, startDate, endDate, type, excludeTransfers } = input;

  const rows = await aggregateTransactions(ctx.userId, {
    groupBy,
    startDate,
    endDate,
    type,
    excludeTransfers,
  });

  const grandTotalCents = rows.reduce((sum, r) => sum + r.totalCents, 0n);

  return {
    groups: rows.map((r) => ({
      key: r.key,
      totalDollars: centsToNumber(r.totalCents),
      transactionCount: r.count,
    })),
    grandTotalDollars: centsToNumber(grandTotalCents),
    dateRange: { start: startDate, end: endDate },
  };
}
