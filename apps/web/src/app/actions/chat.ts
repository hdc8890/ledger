'use server';

import { revalidatePath } from 'next/cache';
import { getCurrentUserId } from '@/lib/auth-helpers';
import { deleteChatSession, getChatSessionById } from '@/db/queries/chat-sessions';
import type { ChatSessionId } from '@/shared/types';

/**
 * Delete a chat session (and all its messages via cascade).
 * Validates ownership before deleting.
 */
export async function deleteSessionAction(sessionId: string): Promise<{ error?: string }> {
  const userId = await getCurrentUserId();
  if (!userId) return { error: 'Unauthorized' };

  const session = await getChatSessionById(sessionId as ChatSessionId);
  if (!session) return { error: 'Session not found' };
  if (session.userId !== userId) return { error: 'Forbidden' };

  await deleteChatSession(sessionId as ChatSessionId);
  revalidatePath('/chat');
  return {};
}
