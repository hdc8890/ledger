/**
 * detect-recurring — Phase 4 Task 4
 *
 * Inngest function that clusters enriched transactions by normalized merchant,
 * amount band, and posting-date cadence to detect recurring payment series
 * (subscriptions, utilities, bills). Persists results in `recurring_series`.
 *
 * Triggered by 'enrichment/transactions.detect-recurring', emitted by
 * detect-transfers after transfer detection completes, completing the
 * enrichment pipeline:
 *
 *   item-sync → normalize → categorize → detect-transfers → detect-recurring
 *
 * Idempotent: upserts on (user_id, merchant_normalized, cadence) so re-runs
 * update existing rows rather than duplicating them.
 * No LLM calls — purely heuristic.
 */

import { inngest } from '@/lib/inngest';
import {
  getTransactionsForRecurringDetection,
  upsertRecurringSeries,
} from '@/db/queries/recurring-series';
import { detectRecurringSeries } from '@/lib/enrich/recurring-series';
import { insertAuditEvent } from '@/db/queries/audit-events';
import type { UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Core handler — exported for unit testing
// ---------------------------------------------------------------------------

export type DetectRecurringContext = {
  event: { data: { userId: string } };
  step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
};

export type DetectRecurringResult = {
  userId: string;
  seriesFound: number;
};

export async function handleDetectRecurring(
  ctx: DetectRecurringContext,
): Promise<DetectRecurringResult> {
  const { userId } = ctx.event.data;
  const { step } = ctx;

  const seriesFound = await step.run('detect-and-persist-recurring-series', async () => {
    const candidates = await getTransactionsForRecurringDetection(userId as UserId);

    if (candidates.length === 0) return 0;

    const detected = detectRecurringSeries(candidates, userId as UserId);

    for (const series of detected) {
      const seriesId = await upsertRecurringSeries({
        userId: series.userId,
        merchantNormalized: series.merchantNormalized,
        cadence: series.cadence,
        expectedAmountCents: series.expectedAmountCents,
        amountTolerancePct: series.amountTolerancePct,
        nextExpectedAt: series.nextExpectedAt ?? null,
        lastSeenAt: series.lastSeenAt,
        confidence: series.confidence,
      });

      await insertAuditEvent({
        actor: userId,
        action: 'enrichment.recurring_detect',
        entityType: 'recurring_series',
        entityId: seriesId,
        before: null,
        after: {
          merchantNormalized: series.merchantNormalized,
          cadence: series.cadence,
          expectedAmountCents: String(series.expectedAmountCents),
          confidence: series.confidence,
          nextExpectedAt: series.nextExpectedAt,
        },
        source: 'system',
        confidence: series.confidence,
      });
    }

    return detected.length;
  });

  return { userId, seriesFound };
}

// ---------------------------------------------------------------------------
// Inngest function registration
// ---------------------------------------------------------------------------

/**
 * enrichment/transactions.detect-recurring — identify recurring payment series.
 *
 * Event payload: { userId: string }
 * Emitted by: detect-transfers after transfer detection completes.
 */
export const detectRecurring = inngest.createFunction(
  {
    id: 'enrichment-transactions-detect-recurring',
    name: 'Enrich Transactions: Recurring Bill Detection',
    triggers: [{ event: 'enrichment/transactions.detect-recurring' }],
  },
  handleDetectRecurring,
);
