import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { chatSessions } from '@/db/schema';
import type { ChatSessionId, UserId } from '@/shared/types';

export type ChatSessionRow = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;

/**
 * Insert a new chat session for a user.
 */
export async function createChatSession(input: NewChatSession): Promise<ChatSessionRow> {
  const rows = await db.insert(chatSessions).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('createChatSession: no row returned');
  return row;
}

/**
 * Fetch all sessions for a user, newest first.
 */
export async function getChatSessionsByUserId(userId: UserId): Promise<ChatSessionRow[]> {
  return db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.userId, userId))
    .orderBy(desc(chatSessions.updatedAt));
}

/**
 * Fetch a single session by ID. Returns undefined if not found.
 */
export async function getChatSessionById(
  id: ChatSessionId,
): Promise<ChatSessionRow | undefined> {
  const rows = await db.select().from(chatSessions).where(eq(chatSessions.id, id)).limit(1);
  return rows[0];
}

/**
 * Update a session's title (set async after first message).
 */
export async function updateChatSessionTitle(
  id: ChatSessionId,
  title: string,
): Promise<void> {
  await db
    .update(chatSessions)
    .set({ title, updatedAt: new Date() })
    .where(eq(chatSessions.id, id));
}

/**
 * Touch a session's updated_at so it bubbles to the top of the sidebar list.
 */
export async function touchChatSession(id: ChatSessionId): Promise<void> {
  await db.update(chatSessions).set({ updatedAt: new Date() }).where(eq(chatSessions.id, id));
}

/**
 * Hard-delete a session and all its messages (cascade).
 */
export async function deleteChatSession(id: ChatSessionId): Promise<void> {
  await db.delete(chatSessions).where(eq(chatSessions.id, id));
}
