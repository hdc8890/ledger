import { ChatWindow } from '@/components/chat/chat-window';

interface ChatSessionPageProps {
  params: Promise<{ sessionId: string }>;
}

/**
 * /chat/[sessionId] — renders the chat window for a specific session.
 *
 * The ChatWindow is a client component that owns the streaming state via
 * `useChat`. The session row is created lazily in the API route on the
 * first message, so navigating to a new UUID before chatting is safe.
 */
export default async function ChatSessionPage({ params }: ChatSessionPageProps) {
  const { sessionId } = await params;

  return <ChatWindow sessionId={sessionId} />;
}
