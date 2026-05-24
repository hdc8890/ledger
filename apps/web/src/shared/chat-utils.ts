import type { UIMessage } from 'ai';
import type { ChatMessageRow } from '@/db/queries/chat-messages';

/**
 * Convert persisted `chat_messages` rows into the `UIMessage[]` shape
 * expected by the AI SDK v6 `useChat` hook's `initialMessages` prop.
 *
 * Rules:
 * - Only 'user' and 'assistant' rows are surfaced; 'tool' rows are internal
 *   and not meaningful as standalone UI messages.
 * - Content is stored as `{ text: string }` in the DB; we extract that into
 *   the parts array.
 * - Each row's UUID becomes the message ID so the client can stable-key on it.
 */
export function chatRowsToUIMessages(rows: ChatMessageRow[]): UIMessage[] {
  return rows
    .filter((row): row is ChatMessageRow & { role: 'user' | 'assistant' } =>
      row.role === 'user' || row.role === 'assistant',
    )
    .map((row) => {
      const text = (row.content as { text?: string }).text ?? '';
      return {
        id: row.id,
        role: row.role,
        parts: [{ type: 'text' as const, text }],
      } as UIMessage;
    });
}
