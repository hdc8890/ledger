import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { transactions } from '@/db/schema';
import type { AccountId, TransactionId, UserId } from '@/shared/types';

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

/**
 * Insert or update a transaction row, keyed on plaid_transaction_id.
 * On conflict, refreshes mutable fields (amount, pending, posted_at, etc.)
 * that Plaid may update after initial posting.
 * Idempotent — safe to call on every sync for added + modified transactions.
 */
export async function upsertTransaction(input: NewTransaction): Promise<TransactionRow> {
  const rows = await db
    .insert(transactions)
    .values(input)
    .onConflictDoUpdate({
      target: transactions.plaidTransactionId,
      set: {
        postedAt: input.postedAt,
        authorizedAt: input.authorizedAt,
        amountCents: input.amountCents,
        merchantRaw: input.merchantRaw,
        pending: input.pending,
        updatedAt: new Date(),
      },
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('upsertTransaction: no row returned');
  return row;
}

/**
 * Soft-delete a transaction by its Plaid transaction ID.
 * Called for transactions in the `removed` array from /transactions/sync.
 */
export async function softDeleteTransactionByPlaidId(
  plaidTransactionId: string,
  at: Date,
): Promise<void> {
  await db
    .update(transactions)
    .set({ deletedAt: at, updatedAt: at })
    .where(eq(transactions.plaidTransactionId, plaidTransactionId));
}

/**
 * Fetch active (non-deleted) transactions for a user, newest first.
 * Accepts optional pagination parameters.
 */
export async function getTransactionsByUserId(
  userId: UserId,
  options: { limit?: number; offset?: number } = {},
): Promise<TransactionRow[]> {
  const { limit = 100, offset = 0 } = options;
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))
    .limit(limit)
    .offset(offset);
}

/**
 * Fetch all active transactions for an account.
 */
export async function getTransactionsByAccountId(accountId: AccountId): Promise<TransactionRow[]> {
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), isNull(transactions.deletedAt)));
}

/**
 * Fetch a single transaction by internal UUID. Returns undefined if not found.
 */
export async function getTransactionById(id: TransactionId): Promise<TransactionRow | undefined> {
  const rows = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  return rows[0];
}
