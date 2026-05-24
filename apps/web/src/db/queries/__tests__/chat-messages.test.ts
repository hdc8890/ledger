import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockOrderBy = vi.fn();
  const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockReturning, mockValues, mockInsert, mockOrderBy, mockWhere, mockSelect };
});

const { mockReturning, mockValues, mockInsert, mockOrderBy } = mocks;

vi.mock('@/lib/db', () => ({
  db: {
    insert: mocks.mockInsert,
    select: mocks.mockSelect,
  },
}));

vi.mock('@/db/schema', () => ({
  chatMessages: { id: 'id', sessionId: 'session_id', role: 'role', content: 'content', createdAt: 'created_at' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
  asc: vi.fn((col: string) => `${col} ASC`),
}));

import { insertChatMessage, getChatMessagesBySessionId } from '../chat-messages';
import type { ChatMessageId, ChatSessionId } from '@/shared/types';

const sampleMessage = {
  id: 'msg-uuid-1' as ChatMessageId,
  sessionId: 'sess-uuid-1' as ChatSessionId,
  role: 'user' as const,
  content: { text: 'Hello' },
  toolCalls: null,
  createdAt: new Date(),
};

describe('insertChatMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the inserted message', async () => {
    mockReturning.mockResolvedValueOnce([sampleMessage]);

    const result = await insertChatMessage(sampleMessage);

    expect(result).toEqual(sampleMessage);
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledWith(sampleMessage);
  });

  it('throws if no row returned', async () => {
    mockReturning.mockResolvedValueOnce([]);

    await expect(insertChatMessage(sampleMessage)).rejects.toThrow(
      'insertChatMessage: no row returned',
    );
  });
});

describe('getChatMessagesBySessionId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns messages in chronological order', async () => {
    mockOrderBy.mockResolvedValueOnce([sampleMessage]);

    const result = await getChatMessagesBySessionId('sess-uuid-1' as ChatSessionId);

    expect(result).toEqual([sampleMessage]);
  });

  it('returns empty array when session has no messages', async () => {
    mockOrderBy.mockResolvedValueOnce([]);

    const result = await getChatMessagesBySessionId('sess-uuid-empty' as ChatSessionId);

    expect(result).toEqual([]);
  });
});
