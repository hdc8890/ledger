import { z } from 'zod';
import { getTransactionById } from '@/db/queries/transactions';
import { insertPendingChange } from '@/db/queries/pending-changes';
import type { TransactionId } from '@/shared/types';
import type { ToolContext } from './context';

export const inputSchema = z.object({
  transactionId: z.string().uuid(),
  /** The proposed category to assign to this transaction. */
  category: z.string().min(1),
});

export const outputSchema = z.object({
  proposalId: z.string(),
  description: z.string(),
  transactionId: z.string(),
  merchantRaw: z.string(),
  currentCategory: z.string().nullable(),
  proposedCategory: z.string(),
});

export type TagTransactionOutput = z.infer<typeof outputSchema>;

/** Serialized shape stored in pending_changes.payload for kind='txn_tag'. */
export type TxnTagPayload = {
  readonly transactionId: string;
  readonly category: string;
};

export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<TagTransactionOutput> {
  const txn = await getTransactionById(input.transactionId as TransactionId);
  if (!txn) throw new Error(`Transaction ${input.transactionId} not found`);
  if (txn.userId !== ctx.userId) throw new Error('Transaction not found');

  const payload = {
    transactionId: input.transactionId,
    category: input.category,
  } satisfies TxnTagPayload;

  const proposal = await insertPendingChange({
    userId: ctx.userId,
    kind: 'txn_tag',
    payload,
    status: 'pending',
  });

  const merchant = txn.merchantNormalized ?? txn.merchantRaw;
  return {
    proposalId: proposal.id,
    description: `Proposed category "${input.category}" for "${merchant}"${txn.category ? ` (currently "${txn.category}")` : ''}`,
    transactionId: txn.id,
    merchantRaw: txn.merchantRaw,
    currentCategory: txn.category ?? null,
    proposedCategory: input.category,
  };
}
