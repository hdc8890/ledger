import { z } from 'zod';
import { getAssetsByUserId } from '@/db/queries/assets';
import { centsToNumber } from '@/shared/money';
import type { ToolContext } from './context';

export const inputSchema = z.object({});

export const outputSchema = z.object({
  assets: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      name: z.string(),
      valueDollars: z.number(),
      source: z.string(),
      confidence: z.number(),
      manualOverride: z.boolean(),
    }),
  ),
  totalValueDollars: z.number(),
  totalAssets: z.number(),
});

export type GetAssetsOutput = z.infer<typeof outputSchema>;

export async function handler(
  _input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<GetAssetsOutput> {
  const rows = await getAssetsByUserId(ctx.userId);
  const totalValueCents = rows.reduce((sum, a) => sum + a.valueCents, 0n);
  return {
    assets: rows.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      valueDollars: centsToNumber(a.valueCents),
      source: a.source,
      confidence: a.confidence,
      manualOverride: a.manualOverride,
    })),
    totalValueDollars: centsToNumber(totalValueCents),
    totalAssets: rows.length,
  };
}
