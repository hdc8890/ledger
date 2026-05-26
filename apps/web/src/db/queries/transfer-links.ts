import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { transferLinks, transactions } from '@/db/schema';
import { insertAuditEvent } from '@/db/queries/audit-events';
import type { TransactionId, UserId } from '@/shared/types';

export type TransferLinkRow = typeof transferLinks.$inferSelect;
export type NewTransferLink = typeof transferLinks.$inferInsert;

/**
 * Insert a transfer link pair.
 * Uses ON CONFLICT DO NOTHING so the call is idempotent — if the pair
 * already exists the row is silently skipped and the existing row is returned.
 */
export async function upsertTransferLink(input: NewTransferLink): Promise<void> {
  await db
    .insert(transferLinks)
    .values(input)
    .onConflictDoNothing({ target: [transferLinks.outTxnId, transferLinks.inTxnId] });
}

/**
 * Fetch all transfer links for a user.
 */
export async function getTransferLinksByUserId(userId: UserId): Promise<TransferLinkRow[]> {
  return db.select().from(transferLinks).where(eq(transferLinks.userId, userId));
}

/**
 * Fetch active, non-pending transactions for a user that have not yet been
 * identified as transfers, within a rolling look-back window.
 *
 * Used by the transfer detection Inngest job. Results are ordered by
 * posted_at ascending so pairs are discovered in chronological order.
 *
 * @param lookbackDays  How many calendar days back to search (default 90).
 */
export async function getTransactionsForTransferDetection(
  userId: UserId,
  lookbackDays = 90,
): Promise<
  {
    readonly id: TransactionId;
    readonly accountId: string;
    readonly amountCents: bigint;
    readonly postedAt: string;
  }[]
> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - lookbackDays);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const rows = await db
    .select({
      id: transactions.id,
      accountId: transactions.accountId,
      amountCents: transactions.amountCents,
      postedAt: transactions.postedAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        sql`${transactions.deletedAt} IS NULL`,
        sql`${transactions.pending} = false`,
        sql`${transactions.isTransfer} = false`,
        sql`${transactions.postedAt} >= ${cutoffStr}`,
      ),
    )
    .orderBy(transactions.postedAt);

  return rows.map((r) => ({
    id: r.id as TransactionId,
    accountId: r.accountId,
    amountCents: r.amountCents,
    postedAt: r.postedAt,
  }));
}

/**
 * Mark a transaction as an internal transfer.
 * Called for both the debit and credit legs of each detected pair.
 */
export async function markTransactionAsTransfer(id: TransactionId): Promise<void> {
  await db
    .update(transactions)
    .set({ isTransfer: true, updatedAt: new Date() })
    .where(eq(transactions.id, id));
}

/**
 * Return the count of transfer links for a user. Used for diagnostics.
 */
export async function countTransferLinksByUserId(userId: UserId): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transferLinks)
    .where(eq(transferLinks.userId, userId));
  return rows[0]?.count ?? 0;
}

/**
 * Unlink a transfer pair that was incorrectly identified by the heuristic.
 * This is the manual override path (AGENTS.md §0, §1):
 *   - Deletes the transfer_links row.
 *   - Resets is_transfer = false on both transaction legs.
 *   - Writes audit_events for both legs with source='user' so the correction
 *     is traceable.
 *
 * Called by the correction UI (Phase 4 Task 6). After unlinking, both
 * transactions will reappear in spending/income totals on the next query.
 *
 * @param outTxnId  Debit leg of the pair (amountCents > 0).
 * @param inTxnId   Credit leg of the pair (amountCents < 0).
 * @param userId    The authenticated user making the correction.
 */
export async function unlinkTransferPair(
  outTxnId: TransactionId,
  inTxnId: TransactionId,
  userId: UserId,
): Promise<void> {
  // Delete the explicit link row.
  await db
    .delete(transferLinks)
    .where(
      and(eq(transferLinks.outTxnId, outTxnId), eq(transferLinks.inTxnId, inTxnId)),
    );

  // Reset both legs — user override takes precedence over system detection.
  const now = new Date();
  await db
    .update(transactions)
    .set({ isTransfer: false, updatedAt: now })
    .where(eq(transactions.id, outTxnId));
  await db
    .update(transactions)
    .set({ isTransfer: false, updatedAt: now })
    .where(eq(transactions.id, inTxnId));

  // Audit both legs so the override is traceable.
  await insertAuditEvent({
    actor: userId,
    action: 'enrichment.transfer_unlink',
    entityType: 'transaction',
    entityId: outTxnId,
    before: { isTransfer: true },
    after: { isTransfer: false, unlinkedPeer: inTxnId },
    source: 'user',
    confidence: 1.0,
  });
  await insertAuditEvent({
    actor: userId,
    action: 'enrichment.transfer_unlink',
    entityType: 'transaction',
    entityId: inTxnId,
    before: { isTransfer: true },
    after: { isTransfer: false, unlinkedPeer: outTxnId },
    source: 'user',
    confidence: 1.0,
  });
}
