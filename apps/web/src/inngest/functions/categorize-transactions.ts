/**
 * categorize-transactions — Phase 4 Task 2
 *
 * Inngest function that applies the two-tier category inference pipeline
 * (deterministic rules → LLM fallback) to uncategorized or Plaid-only-categorized
 * transactions for a user.
 *
 * Triggered by 'enrichment/transactions.categorize', emitted by enrich-transactions
 * after merchant normalization completes so merchant_normalized is available.
 *
 * Processes transactions in batches of 50. Idempotent: transactions where
 * categorySource is already 'user', 'rule', or 'ai' are skipped.
 */

import { inngest } from '@/lib/inngest';
import {
  getTransactionsNeedingCategorization,
  updateTransactionCategoryEnriched,
} from '@/db/queries/transactions';
import { getActiveCategorizationRulesByUserId } from '@/db/queries/categorization-rules';
import { categorizeBatch } from '@/lib/enrich/categorize';
import { insertAuditEvent } from '@/db/queries/audit-events';
import type { UserId, TransactionId } from '@/shared/types';

const BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Core handler — exported for unit testing
// ---------------------------------------------------------------------------

export type CategorizeTransactionsContext = {
  event: { data: { userId: string } };
  step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
};

export type CategorizeTransactionsResult = {
  userId: string;
  processed: number;
  batches: number;
};

export async function handleCategorizeTransactions(
  ctx: CategorizeTransactionsContext,
): Promise<CategorizeTransactionsResult> {
  const { userId } = ctx.event.data;
  const { step } = ctx;

  // Load active rules once — they're user-specific and don't change during the job.
  const rules = await step.run('load-categorization-rules', () =>
    getActiveCategorizationRulesByUserId(userId as UserId),
  );

  let totalProcessed = 0;
  let batchIndex = 0;

  while (true) {
    const batchResult = await step.run(`categorize-batch-${batchIndex}`, async () => {
      const txns = await getTransactionsNeedingCategorization(userId as UserId, {
        limit: BATCH_SIZE,
        offset: 0,
      });

      if (txns.length === 0) return { count: 0, done: true };

      const categorized = await categorizeBatch(txns, userId as UserId, rules);

      for (const txn of txns) {
        const result = categorized.get(txn.id as TransactionId);
        if (result !== undefined) {
          await updateTransactionCategoryEnriched(
            txn.id as TransactionId,
            result.category,
            result.source,
            result.confidence,
          );
          await insertAuditEvent({
            actor: userId,
            action: 'enrichment.category_infer',
            entityType: 'transaction',
            entityId: txn.id,
            before: { category: txn.category, categorySource: txn.categorySource },
            after: { category: result.category, categorySource: result.source, confidence: result.confidence },
            source: result.source === 'rule' ? 'rule' : 'ai',
            confidence: result.confidence,
          });
        }
      }

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
 * enrichment/transactions.categorize — apply category inference post-normalization.
 *
 * Event payload: { userId: string }
 * Emitted by: enrich-transactions after merchant normalization completes.
 */
export const categorizeTransactions = inngest.createFunction(
  {
    id: 'enrichment-transactions-categorize',
    name: 'Enrich Transactions: Category Inference',
    triggers: [{ event: 'enrichment/transactions.categorize' }],
  },
  handleCategorizeTransactions,
);
