import { auth } from '@clerk/nextjs/server';
import { redirect, notFound } from 'next/navigation';
import { findUserByClerkId } from '@/db/queries/users';
import { getChatSessionById } from '@/db/queries/chat-sessions';
import { getChatMessagesBySessionId } from '@/db/queries/chat-messages';
import { listPendingProposals } from '@/db/queries/memories';
import { chatRowsToUIMessages } from '@/shared/chat-utils';
import { ChatWindow } from '@/components/chat/chat-window';
import type { ChatSessionId, UserId } from '@/shared/types';

interface ChatSessionPageProps {
  params: Promise<{ sessionId: string }>;
}

/**
 * /chat/[sessionId] — renders the chat window for a specific session.
 *
 * For new sessions (UUID not yet in DB), renders an empty window; the session
 * row is created lazily on the first message. For existing sessions, loads
 * persisted messages from DB and passes them as initialMessages to the chat
 * hook so the conversation is immediately resumable.
 *
 * Also loads any pending memory proposals so the chip UI is pre-populated on
 * page load (before any new turn triggers a client-side poll).
 */
export default async function ChatSessionPage({ params }: ChatSessionPageProps) {
  const { sessionId } = await params;

  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const user = await findUserByClerkId(clerkId);
  if (!user) redirect('/sign-in');

  const userId = user.id as UserId;

  // Validate the session exists and belongs to this user.
  // A session may not exist yet if the UUID is freshly generated on the client
  // before the first message — that is fine; we render an empty window.
  const session = await getChatSessionById(sessionId as ChatSessionId);

  if (session && session.userId !== userId) {
    notFound();
  }

  const [rows, pendingProposals] = await Promise.all([
    session ? getChatMessagesBySessionId(sessionId as ChatSessionId) : Promise.resolve([]),
    listPendingProposals(userId),
  ]);

  const initialMessages = chatRowsToUIMessages(rows);

  return (
    <ChatWindow
      sessionId={sessionId}
      initialMessages={initialMessages}
      initialProposals={pendingProposals}
    />
  );
}
