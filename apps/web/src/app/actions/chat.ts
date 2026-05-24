'use server';

import { auth } from '@clerk/nextjs/server';
import { revalidatePath } from 'next/cache';
import { findUserByClerkId } from '@/db/queries/users';
import { deleteChatSession, getChatSessionById } from '@/db/queries/chat-sessions';
import type { ChatSessionId } from '@/shared/types';

/**
 * Delete a chat session (and all its messages via cascade).
 * Validates ownership before deleting.
 */
export async function deleteSessionAction(sessionId: string): Promise<{ error?: string }> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return { error: 'Unauthorized' };

  const user = await findUserByClerkId(clerkId);
  if (!user) return { error: 'User not found' };

  const session = await getChatSessionById(sessionId as ChatSessionId);
  if (!session) return { error: 'Session not found' };
  if (session.userId !== user.id) return { error: 'Forbidden' };

  await deleteChatSession(sessionId as ChatSessionId);
  revalidatePath('/chat');
  return {};
}
