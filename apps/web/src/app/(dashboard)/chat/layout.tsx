import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { findUserByClerkId } from '@/db/queries/users';
import { getChatSessionsByUserId } from '@/db/queries/chat-sessions';
import { ConversationSidebar } from '@/components/chat/conversation-sidebar';
import type { UserId } from '@/shared/types';

/**
 * Chat layout — wraps all `/chat/*` pages.
 *
 * Fetches the session list server-side so the ConversationSidebar renders on
 * initial load without a client-side fetch. The active session ID is derived
 * from the URL by the child page and passed down as a prop — here we leave
 * the sidebar without an `activeSessionId`; the sidebar component highlights
 * active sessions via pathname comparison on the client.
 */
export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const user = await findUserByClerkId(clerkId);
  const sessions = user
    ? await getChatSessionsByUserId(user.id as UserId)
    : [];

  return (
    <div className="-m-6 flex overflow-hidden" style={{ height: 'calc(100vh - 0px)' }}>
      <ConversationSidebar sessions={sessions} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
