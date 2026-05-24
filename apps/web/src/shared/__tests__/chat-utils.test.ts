import { describe, it, expect } from 'vitest';
import { chatRowsToUIMessages } from '../chat-utils';
import type { ChatMessageRow } from '@/db/queries/chat-messages';
import type { ChatSessionId, ChatMessageId } from '@/shared/types';

const SESSION_ID = 'sess-uuid-1' as ChatSessionId;

function makeRow(
  id: string,
  role: ChatMessageRow['role'],
  text: string,
): ChatMessageRow {
  return {
    id: id as ChatMessageId,
    sessionId: SESSION_ID,
    role,
    content: { text },
    toolCalls: null,
    createdAt: new Date('2024-01-01T00:00:00Z'),
  };
}

describe('chatRowsToUIMessages', () => {
  it('returns empty array for empty input', () => {
    expect(chatRowsToUIMessages([])).toEqual([]);
  });

  it('converts a user row to a UIMessage with text part', () => {
    const rows = [makeRow('msg-1', 'user', 'Hello there')];
    const result = chatRowsToUIMessages(rows);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'msg-1',
      role: 'user',
      parts: [{ type: 'text', text: 'Hello there' }],
    });
  });

  it('converts an assistant row to a UIMessage with text part', () => {
    const rows = [makeRow('msg-2', 'assistant', 'I can help with that.')];
    const result = chatRowsToUIMessages(rows);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'msg-2',
      role: 'assistant',
      parts: [{ type: 'text', text: 'I can help with that.' }],
    });
  });

  it('filters out tool rows', () => {
    const rows = [
      makeRow('msg-1', 'user', 'How much did I spend?'),
      makeRow('msg-2', 'tool', JSON.stringify({ result: 'data' })),
      makeRow('msg-3', 'assistant', 'You spent $200.'),
    ];
    const result = chatRowsToUIMessages(rows);

    expect(result).toHaveLength(2);
    expect(result.map((m) => m.id)).toEqual(['msg-1', 'msg-3']);
  });

  it('handles missing text in content gracefully', () => {
    const row: ChatMessageRow = {
      id: 'msg-4' as ChatMessageId,
      sessionId: SESSION_ID,
      role: 'user',
      content: {},
      toolCalls: null,
      createdAt: new Date(),
    };
    const result = chatRowsToUIMessages([row]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      parts: [{ type: 'text', text: '' }],
    });
  });

  it('preserves message ordering', () => {
    const rows = [
      makeRow('msg-a', 'user', 'First'),
      makeRow('msg-b', 'assistant', 'Second'),
      makeRow('msg-c', 'user', 'Third'),
    ];
    const result = chatRowsToUIMessages(rows);

    expect(result.map((m) => m.id)).toEqual(['msg-a', 'msg-b', 'msg-c']);
  });
});
