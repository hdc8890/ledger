import { z } from 'zod';
import { queryTransactionsByFilter } from '@/db/queries/transactions';
import { centsToNumber, dollarsToCents } from '@/shared/money';
import type { ToolContext } from './context';

export const inputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
  /** Filter to transactions on or after this date (YYYY-MM-DD). */
  startDate: z.string().optional(),
  /** Filter to transactions on or before this date (YYYY-MM-DD). */
  endDate: z.string().optional(),
  /** Filter to a specific category (exact match). */
  category: z.string().optional(),
  /** Filter to a specific account UUID. */
  accountId: z.string().optional(),
  /** Only include transactions above this dollar amount (absolute value). */
  minAmountDollars: z.number().positive().optional(),
  /** Only include transactions below this dollar amount (absolute value). */
  maxAmountDollars: z.number().positive().optional(),
});

export const outputSchema = z.object({
  transactions: z.array(
    z.object({
      id: z.string(),
      merchant: z.string(),
      category: z.string().nullable(),
      /** Positive = debit (money out), negative = credit (money in). */
      amountDollars: z.number(),
      postedAt: z.string(),
      accountId: z.string(),
      pending: z.boolean(),
      isTransfer: z.boolean(),
    }),
  ),
  count: z.number(),
});

export type GetTransactionsOutput = z.infer<typeof outputSchema>;

export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<GetTransactionsOutput> {
  const { limit, offset, startDate, endDate, category, accountId, minAmountDollars, maxAmountDollars } = input;

  const rows = await queryTransactionsByFilter(ctx.userId, {
    limit,
    offset,
    ...(startDate !== undefined && { startDate }),
    ...(endDate !== undefined && { endDate }),
    ...(category !== undefined && { category }),
    ...(accountId !== undefined && { accountId }),
    ...(minAmountDollars !== undefined && { minAmountCents: dollarsToCents(minAmountDollars) }),
    ...(maxAmountDollars !== undefined && { maxAmountCents: dollarsToCents(maxAmountDollars) }),
  });

  return {
    transactions: rows.map((t) => ({
      id: t.id,
      merchant: t.merchantNormalized ?? t.merchantRaw,
      category: t.category ?? null,
      amountDollars: centsToNumber(t.amountCents),
      postedAt: t.postedAt,
      accountId: t.accountId,
      pending: t.pending,
      isTransfer: t.isTransfer,
    })),
    count: rows.length,
  };
}
