import { z } from 'zod';
import { getAssetById } from '@/db/queries/assets';
import { insertPendingChange } from '@/db/queries/pending-changes';
import { centsToNumber, dollarsToCents } from '@/shared/money';
import type { AssetId } from '@/shared/types';
import type { ToolContext } from './context';

export const inputSchema = z.object({
  assetId: z.string().uuid(),
  /** New value in dollars (positive). */
  valueDollars: z.number().positive().optional(),
  /** Updated display name. */
  name: z.string().min(1).optional(),
});

export const outputSchema = z.object({
  proposalId: z.string(),
  description: z.string(),
  assetId: z.string(),
  assetName: z.string(),
  changes: z.object({
    valueDollars: z.object({ from: z.number(), to: z.number() }).optional(),
    name: z.object({ from: z.string(), to: z.string() }).optional(),
  }),
});

export type UpdateAssetOutput = z.infer<typeof outputSchema>;

/**
 * Serialized shape stored in pending_changes.payload for kind='asset_update'.
 *
 * Bigint values (e.g. valueCents) are stored as numeric strings because JSONB
 * does not support bigint. The approval server action (Task 4) must reconstruct
 * them with BigInt(payload.valueCents) before writing to the DB.
 */
export type AssetUpdatePayload = {
  readonly assetId: string;
  /** Positive bigint cents serialized as a decimal string. Reconstruct with BigInt(valueCents). */
  readonly valueCents?: string;
  readonly name?: string;
};

export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<UpdateAssetOutput> {
  const asset = await getAssetById(input.assetId as AssetId);
  if (!asset) throw new Error(`Asset ${input.assetId} not found`);
  if (asset.userId !== ctx.userId) throw new Error('Asset not found');

  const changes: UpdateAssetOutput['changes'] = {};
  const descParts: string[] = [];

  if (input.valueDollars !== undefined) {
    changes.valueDollars = {
      from: centsToNumber(asset.valueCents),
      to: input.valueDollars,
    };
    descParts.push(`value from $${changes.valueDollars.from.toFixed(2)} to $${input.valueDollars.toFixed(2)}`);
  }

  if (input.name !== undefined) {
    changes.name = { from: asset.name, to: input.name };
    descParts.push(`name from "${asset.name}" to "${input.name}"`);
  }

  if (descParts.length === 0) throw new Error('No changes specified');

  const payload: AssetUpdatePayload = {
    assetId: input.assetId,
    ...(input.valueDollars !== undefined && {
      valueCents: dollarsToCents(input.valueDollars).toString(),
    }),
    ...(input.name !== undefined && { name: input.name }),
  };

  const proposal = await insertPendingChange({
    userId: ctx.userId,
    kind: 'asset_update',
    payload,
    status: 'pending',
  });

  return {
    proposalId: proposal.id,
    description: `Proposed update to "${asset.name}": ${descParts.join(', ')}`,
    assetId: asset.id,
    assetName: asset.name,
    changes,
  };
}
