import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { plaidItems } from '@/db/schema';
import type { PlaidItemId, UserId } from '@/shared/types';

export type PlaidItemRow = typeof plaidItems.$inferSelect;
export type NewPlaidItem = typeof plaidItems.$inferInsert;

/**
 * Insert a new Plaid item. Returns the created row.
 * Called after a successful Plaid Link token exchange.
 */
export async function insertPlaidItem(input: NewPlaidItem): Promise<PlaidItemRow> {
  const rows = await db.insert(plaidItems).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('insertPlaidItem: no row returned');
  return row;
}

/**
 * Fetch all non-deleted Plaid items for a user.
 */
export async function getPlaidItemsByUserId(userId: UserId): Promise<PlaidItemRow[]> {
  return db.select().from(plaidItems).where(eq(plaidItems.userId, userId));
}

/**
 * Fetch a single Plaid item by internal UUID. Returns undefined if not found.
 */
export async function getPlaidItemById(id: PlaidItemId): Promise<PlaidItemRow | undefined> {
  const rows = await db.select().from(plaidItems).where(eq(plaidItems.id, id)).limit(1);
  return rows[0];
}

/**
 * Persist the updated transactions/sync cursor and last-synced timestamp.
 * Called at the end of each successful sync run.
 */
export async function updatePlaidItemCursor(
  id: PlaidItemId,
  cursor: string,
  lastSyncedAt: Date,
): Promise<void> {
  await db
    .update(plaidItems)
    .set({ cursor, lastSyncedAt, updatedAt: new Date() })
    .where(eq(plaidItems.id, id));
}

/**
 * Update the status of a Plaid item (e.g. to 'disconnected' or 'error').
 */
export async function updatePlaidItemStatus(
  id: PlaidItemId,
  status: PlaidItemRow['status'],
): Promise<void> {
  await db
    .update(plaidItems)
    .set({ status, updatedAt: new Date() })
    .where(eq(plaidItems.id, id));
}
