/**
 * detect-transfers — Phase 4 Task 3
 *
 * Inngest function that pairs debit/credit transactions from different accounts
 * for the same user, marks both legs with is_transfer = true, and records the
 * pair in transfer_links.
 *
 * Triggered by 'enrichment/transactions.detect-transfers', emitted by
 * categorize-transactions after category inference completes, completing the
 * enrichment pipeline:
 *
 *   item-sync → normalize → categorize → detect-transfers
 *
 * Idempotent: only fetches transactions where is_transfer = false.
 * No LLM calls — purely heuristic.
 */

import { inngest } from '@/lib/inngest';
import {
  getTransactionsForTransferDetection,
  upsertTransferLink,
  markTransactionAsTransfer,
} from '@/db/queries/transfer-links';
import { detectTransferPairs } from '@/lib/enrich/detect-transfers';
import { insertAuditEvent } from '@/db/queries/audit-events';
import type { UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Core handler — exported for unit testing
// ---------------------------------------------------------------------------

export type DetectTransfersContext = {
  event: { data: { userId: string } };
  step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
};

export type DetectTransfersResult = {
  userId: string;
  pairsFound: number;
};

export async function handleDetectTransfers(
  ctx: DetectTransfersContext,
): Promise<DetectTransfersResult> {
  const { userId } = ctx.event.data;
  const { step } = ctx;

  const pairsFound = await step.run('detect-and-persist-transfer-pairs', async () => {
    // Fetch all eligible transactions in one go — transfer detection requires
    // comparing pairs across the entire candidate set (no chunking).
    const candidates = await getTransactionsForTransferDetection(userId as UserId);

    if (candidates.length === 0) return 0;

    const pairs = detectTransferPairs(candidates);

    for (const pair of pairs) {
      // Mark both transaction legs.
      await markTransactionAsTransfer(pair.outTxnId);
      await markTransactionAsTransfer(pair.inTxnId);

      // Persist the explicit link (idempotent).
      await upsertTransferLink({
        userId,
        outTxnId: pair.outTxnId,
        inTxnId: pair.inTxnId,
        confidence: pair.confidence,
      });

      // Audit both legs independently for full traceability.
      await insertAuditEvent({
        actor: userId,
        action: 'enrichment.transfer_detect',
        entityType: 'transaction',
        entityId: pair.outTxnId,
        before: { isTransfer: false },
        after: { isTransfer: true, transferLinkPeer: pair.inTxnId, confidence: pair.confidence },
        source: 'system',
        confidence: pair.confidence,
      });
      await insertAuditEvent({
        actor: userId,
        action: 'enrichment.transfer_detect',
        entityType: 'transaction',
        entityId: pair.inTxnId,
        before: { isTransfer: false },
        after: { isTransfer: true, transferLinkPeer: pair.outTxnId, confidence: pair.confidence },
        source: 'system',
        confidence: pair.confidence,
      });
    }

    return pairs.length;
  });

  return { userId, pairsFound };
}

// ---------------------------------------------------------------------------
// Inngest function registration
// ---------------------------------------------------------------------------

/**
 * enrichment/transactions.detect-transfers — identify internal transfer pairs.
 *
 * Event payload: { userId: string }
 * Emitted by: categorize-transactions after category inference completes.
 */
export const detectTransfers = inngest.createFunction(
  {
    id: 'enrichment-transactions-detect-transfers',
    name: 'Enrich Transactions: Transfer Detection',
    triggers: [{ event: 'enrichment/transactions.detect-transfers' }],
  },
  handleDetectTransfers,
);
