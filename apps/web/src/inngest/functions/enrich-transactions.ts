/**
 * enrich-transactions — Phase 4 Task 1
 *
 * Inngest function that normalises merchant names for a user's transactions.
 * Triggered by 'enrichment/transactions.normalize' after every item-sync.
 *
 * Processes transactions in batches of 50 (LLM batch limit). Idempotent:
 * transactions where merchant_normalized IS NOT NULL are skipped.
 */

import { inngest } from '@/lib/inngest';
import {
  getTransactionsNeedingNormalization,
  updateTransactionMerchantNormalized,
} from '@/db/queries/transactions';
import { normalizeMerchantBatch } from '@/lib/enrich/merchant-normalize';
import { insertAuditEvent } from '@/db/queries/audit-events';
import type { UserId, TransactionId } from '@/shared/types';

const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Core handler — exported for unit testing
// ---------------------------------------------------------------------------

export type EnrichTransactionsContext = {
  event: { data: { userId: string } };
  step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
};

export type EnrichTransactionsResult = {
  userId: string;
  processed: number;
  batches: number;
};

export async function handleEnrichTransactions(
  ctx: EnrichTransactionsContext,
): Promise<EnrichTransactionsResult> {
  const { userId } = ctx.event.data;
  const { step } = ctx;

  let totalProcessed = 0;
  let batchIndex = 0;

  // Process in BATCH_SIZE chunks. Each chunk is a separate Inngest step so
  // that retries are safe (idempotent: already-normalized rows are skipped).
  while (true) {
    const batchResult = await step.run(`normalize-batch-${batchIndex}`, async () => {
      const txns = await getTransactionsNeedingNormalization(userId as UserId, {
        limit: BATCH_SIZE,
        offset: 0,
      });

      if (txns.length === 0) return { count: 0, done: true };

      const rawMerchants = txns.map((t) => t.merchantRaw);
      const normalized = await normalizeMerchantBatch(rawMerchants, userId as UserId);

      for (const txn of txns) {
        const result = normalized.get(txn.merchantRaw);
        if (result !== undefined) {
          await updateTransactionMerchantNormalized(txn.id as TransactionId, result.canonical);
          await insertAuditEvent({
            actor: userId,
            action: 'enrichment.merchant_normalize',
            entityType: 'transaction',
            entityId: txn.id,
            before: { merchantNormalized: null },
            after: { merchantNormalized: result.canonical, source: result.source },
            source: result.source === 'rule' ? 'rule' : 'ai',
            confidence: result.source === 'rule' ? 1.0 : 0.9,
          });
        }
      }

      // Always continue to the next batch — exit only when the next fetch
      // returns empty. Rows we just normalized are excluded by the IS NULL
      // filter so they won't reappear.
      return { count: txns.length, done: false };
    });

    totalProcessed += batchResult.count;
    batchIndex++;

    if (batchResult.done) break;
  }

  return { userId, processed: totalProcessed, batches: batchIndex };
}

// ---------------------------------------------------------------------------
// Inngest function registration
// ---------------------------------------------------------------------------

/**
 * enrichment/transactions.normalize — normalise merchant names post-sync.
 *
 * Event payload: { userId: string }
 * Emitted by: plaid-item-sync after each successful sync run.
 */
export const enrichTransactions = inngest.createFunction(
  {
    id: 'enrichment-transactions-normalize',
    name: 'Enrich Transactions: Merchant Normalize',
    triggers: [{ event: 'enrichment/transactions.normalize' }],
  },
  handleEnrichTransactions,
);
