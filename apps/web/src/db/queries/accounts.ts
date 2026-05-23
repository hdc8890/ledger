import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { accounts } from '@/db/schema';
import type { AccountId, PlaidItemId, UserId } from '@/shared/types';

export type AccountRow = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

/**
 * Insert or update an account row, keyed on plaid_account_id.
 * On conflict, refreshes balance, sync timestamp, and updated_at.
 * Idempotent — safe to call on every sync.
 */
export async function upsertAccount(input: NewAccount): Promise<AccountRow> {
  const rows = await db
    .insert(accounts)
    .values(input)
    .onConflictDoUpdate({
      target: accounts.plaidAccountId,
      set: {
        name: input.name,
        officialName: input.officialName,
        balanceCurrent: input.balanceCurrent,
        balanceAvailable: input.balanceAvailable,
        lastSyncedAt: input.lastSyncedAt,
        updatedAt: new Date(),
      },
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('upsertAccount: no row returned');
  return row;
}

/**
 * Fetch all active (non-deleted) accounts for a user.
 */
export async function getAccountsByUserId(userId: UserId): Promise<AccountRow[]> {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNull(accounts.deletedAt)));
}

/**
 * Fetch all active (non-deleted) accounts belonging to a Plaid item.
 * Used during sync to know which account IDs to use.
 */
export async function getAccountsByPlaidItemId(
  plaidItemId: PlaidItemId,
): Promise<AccountRow[]> {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.plaidItemId, plaidItemId), isNull(accounts.deletedAt)));
}

/**
 * Fetch a single account by internal UUID. Returns undefined if not found.
 */
export async function getAccountById(id: AccountId): Promise<AccountRow | undefined> {
  const rows = await db.select().from(accounts).where(eq(accounts.id, id)).limit(1);
  return rows[0];
}

/**
 * Soft-delete all accounts for a Plaid item.
 * Called when the item is disconnected so history is preserved.
 */
export async function softDeleteAccountsByPlaidItemId(
  plaidItemId: PlaidItemId,
  at: Date,
): Promise<void> {
  await db
    .update(accounts)
    .set({ deletedAt: at, updatedAt: at })
    .where(eq(accounts.plaidItemId, plaidItemId));
}
