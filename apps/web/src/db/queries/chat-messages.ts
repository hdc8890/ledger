import { asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { chatMessages } from '@/db/schema';
import type { ChatMessageId, ChatSessionId } from '@/shared/types';

export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;

/**
 * Persist a single chat message (user or assistant turn).
 */
export async function insertChatMessage(input: NewChatMessage): Promise<ChatMessageRow> {
  const rows = await db.insert(chatMessages).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('insertChatMessage: no row returned');
  return row;
}

/**
 * Fetch all messages for a session in chronological order.
 */
export async function getChatMessagesBySessionId(
  sessionId: ChatSessionId,
): Promise<ChatMessageRow[]> {
  return db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt));
}

/**
 * Fetch the last N messages for a session (used for context window truncation).
 */
export async function getRecentChatMessages(
  sessionId: ChatSessionId,
  limit: number,
): Promise<ChatMessageRow[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sessionId, sessionId))
    .orderBy(asc(chatMessages.createdAt))
    .limit(limit);
  return rows;
}

/**
 * Fetch a single message by ID.
 */
export async function getChatMessageById(
  id: ChatMessageId,
): Promise<ChatMessageRow | undefined> {
  const rows = await db.select().from(chatMessages).where(eq(chatMessages.id, id)).limit(1);
  return rows[0];
}
