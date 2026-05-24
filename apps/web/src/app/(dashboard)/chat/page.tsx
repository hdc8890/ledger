import { redirect } from 'next/navigation';

/**
 * /chat — redirect to a new session UUID.
 *
 * The session is created lazily in DB on the first message, so navigating
 * here is safe — it won't create orphan DB rows.
 */
export default function ChatPage() {
  const newId = crypto.randomUUID();
  redirect(`/chat/${newId}`);
}
