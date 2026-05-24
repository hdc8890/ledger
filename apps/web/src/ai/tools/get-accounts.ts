import { z } from 'zod';
import { getAccountsByUserId } from '@/db/queries/accounts';
import { centsToNumber } from '@/shared/money';
import type { ToolContext } from './context';

export const inputSchema = z.object({});

export const outputSchema = z.object({
  accounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      officialName: z.string().nullable(),
      type: z.string(),
      subtype: z.string(),
      currency: z.string(),
      balanceCurrentDollars: z.number(),
      balanceAvailableDollars: z.number().nullable(),
    }),
  ),
  totalAccounts: z.number(),
});

export type GetAccountsOutput = z.infer<typeof outputSchema>;

export async function handler(
  _input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<GetAccountsOutput> {
  const rows = await getAccountsByUserId(ctx.userId);
  return {
    accounts: rows.map((a) => ({
      id: a.id,
      name: a.name,
      officialName: a.officialName ?? null,
      type: a.type,
      subtype: a.subtype,
      currency: a.currency,
      balanceCurrentDollars: centsToNumber(a.balanceCurrent),
      balanceAvailableDollars: a.balanceAvailable != null ? centsToNumber(a.balanceAvailable) : null,
    })),
    totalAccounts: rows.length,
  };
}
