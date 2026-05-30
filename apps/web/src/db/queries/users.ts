import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { users } from '@/db/schema';
import type { UserId } from '@/shared/types';

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

/**
 * Fetch all user rows. Used by background cron jobs that must process
 * every registered user (e.g. nightly net-worth snapshot).
 */
export async function getAllUsers(): Promise<UserRow[]> {
  return db.select().from(users);
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
