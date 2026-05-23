import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/db/schema';
import type { UserId } from '@/shared/types';

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * Find a user by their Clerk ID.
 * Returns undefined if no row exists yet (e.g. webhook hasn't fired).
 */
export async function findUserByClerkId(
  clerkId: string,
): Promise<UserRow | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1);
  return rows[0];
}

/**
 * Insert a new users row if it doesn't exist; otherwise return the
 * existing row unchanged.  Keyed on clerk_id — idempotent.
 */
export async function upsertUserByClerkId(input: {
  clerkId: string;
  householdId?: string;
}): Promise<UserRow> {
  const rows = await db
    .insert(users)
    .values({
      clerkId: input.clerkId,
      householdId: input.householdId ?? null,
      settings: {},
    })
    .onConflictDoUpdate({
      target: users.clerkId,
      // Keep existing row untouched — just update updatedAt so the
      // row is returned by the RETURNING clause.
      set: { updatedAt: new Date() },
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('upsertUserByClerkId: no row returned');
  return row;
}

/**
 * Find a user by internal UUID. Throws if not found.
 */
export async function getUserById(id: UserId): Promise<UserRow> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) throw new Error(`User not found: ${id}`);
  return row;
}
