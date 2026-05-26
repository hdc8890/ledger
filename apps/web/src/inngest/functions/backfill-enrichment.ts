/**
 * backfill-enrichment — Phase 4 Task 5
 *
 * Inngest fan-out orchestrator that kicks off the enrichment pipeline
 * (normalize → categorize → detect-transfers → detect-recurring) for all
 * existing users who have unprocessed historical transactions.
 *
 * Triggered by 'enrichment/backfill.start'. Trigger this manually from the
 * Inngest Dev Server dashboard or by sending:
 *
 *   { name: 'enrichment/backfill.start', data: {} }
 *
 * Optional payload fields:
 *   userId  — restrict backfill to a single user (omit for all users)
 *   force   — if true, reset ai/rule enrichment state before re-running;
 *             user overrides (categorySource = 'user') are never touched
 *
 * Idempotency: without force, each per-user enrichment job skips already-
 * processed rows (merchant_normalized IS NOT NULL, categorySource not in
 * NULL/'plaid'). Safe to re-run at any time.
 *
 * Rate limiting: a 2-second sleep is inserted between per-user event
 * emissions to spread out LLM calls and avoid saturating gpt-4o-mini
 * rate limits when many users are being backfilled simultaneously.
 */

import { inngest } from '@/lib/inngest';
import { getAllUsers } from '@/db/queries/users';
import { getUserById } from '@/db/queries/users';
import { resetTransactionEnrichmentForUser } from '@/db/queries/transactions';
import { insertAuditEvent } from '@/db/queries/audit-events';
import type { UserId } from '@/shared/types';

/** Sleep duration between per-user event emissions (rate-limit guard). */
const INTER_USER_SLEEP = '2s';

// ---------------------------------------------------------------------------
// Core handler — exported for unit testing
// ---------------------------------------------------------------------------

export type BackfillEnrichmentContext = {
  event: { data: { userId?: string; force?: boolean } };
  step: {
    run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
    sendEvent: (id: string, event: { name: string; data: Record<string, unknown> }) => Promise<unknown>;
    sleep: (id: string, duration: string) => Promise<void>;
  };
};

export type BackfillEnrichmentResult = {
  fanned: number;
  reset: number;
};

export async function handleBackfillEnrichment(
  ctx: BackfillEnrichmentContext,
): Promise<BackfillEnrichmentResult> {
  const { userId: targetUserId, force = false } = ctx.event.data;
  const { step } = ctx;

  // Fetch the target user set: either the single specified user or all users.
  const users = await step.run('get-users', async () => {
    if (targetUserId !== undefined) {
      const user = await getUserById(targetUserId as UserId);
      return [user];
    }
    return getAllUsers();
  });

  if (users.length === 0) {
    return { fanned: 0, reset: 0 };
  }

  let totalReset = 0;

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    // Type narrowing: users array is UserRow[] which always has id.
    const userId = (user as { id: string }).id;

    if (force) {
      const resetCount = await step.run(`reset-enrichment-${i}`, async () => {
        const count = await resetTransactionEnrichmentForUser(userId as UserId);
        if (count > 0) {
          await insertAuditEvent({
            actor: userId,
            action: 'enrichment.backfill_reset',
            entityType: 'user',
            entityId: userId,
            before: null,
            after: { resetCount: count, force: true },
            source: 'system',
            confidence: 1.0,
          });
        }
        return count;
      });
      totalReset += resetCount;
    }

    await step.sendEvent(`enqueue-normalize-${i}`, {
      name: 'enrichment/transactions.normalize',
      data: { userId },
    });

    // Sleep between emissions (except after the last user) to spread out
    // the concurrent LLM calls triggered by the per-user enrichment jobs.
    if (i < users.length - 1) {
      await step.sleep(`rate-limit-sleep-${i}`, INTER_USER_SLEEP);
    }
  }

  return { fanned: users.length, reset: totalReset };
}

// ---------------------------------------------------------------------------
// Inngest function registration
// ---------------------------------------------------------------------------

/**
 * enrichment/backfill.start — fan out enrichment for historical transactions.
 *
 * Event payload: { userId?: string; force?: boolean }
 *
 * Trigger manually:
 *   inngest.send({ name: 'enrichment/backfill.start', data: {} })
 *   inngest.send({ name: 'enrichment/backfill.start', data: { force: true } })
 *   inngest.send({ name: 'enrichment/backfill.start', data: { userId: '<id>', force: true } })
 */
export const backfillEnrichment = inngest.createFunction(
  {
    id: 'enrichment-backfill',
    name: 'Enrich Transactions: Historical Backfill',
    triggers: [{ event: 'enrichment/backfill.start' }],
  },
  handleBackfillEnrichment,
);
