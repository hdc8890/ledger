import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Drizzle mock — set up before vi.mock factories run.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit, orderBy: mockOrderBy }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockWhereUpdate = vi.fn();
  const mockSet = vi.fn(() => ({ where: mockWhereUpdate }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));
  const mockWhereDelete = vi.fn();
  const mockDelete = vi.fn(() => ({ where: mockWhereDelete }));
  return {
    mockReturning,
    mockValues,
    mockInsert,
    mockLimit,
    mockOrderBy,
    mockWhere,
    mockSet,
    mockUpdate,
    mockDelete,
    mockSelect,
    mockFrom,
    mockWhereUpdate,
    mockWhereDelete,
  };
});

const {
  mockReturning,
  mockValues,
  mockInsert,
  mockLimit,
  mockOrderBy,
  mockSet,
  mockUpdate,
  mockDelete,
} = mocks;

vi.mock('@/lib/db', () => ({
  db: {
    insert: mocks.mockInsert,
    select: mocks.mockSelect,
    update: mocks.mockUpdate,
    delete: mocks.mockDelete,
  },
}));

vi.mock('@/db/schema', () => ({
  chatSessions: { id: 'id', userId: 'user_id', title: 'title', updatedAt: 'updated_at' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
  desc: vi.fn((col: string) => `${col} DESC`),
}));

import {
  createChatSession,
  getChatSessionsByUserId,
  getChatSessionById,
  deleteChatSession,
  touchChatSession,
} from '../chat-sessions';
import type { ChatSessionId, UserId } from '@/shared/types';

const sampleSession = {
  id: 'sess-uuid-1' as ChatSessionId,
  userId: 'user-uuid-1' as UserId,
  title: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('createChatSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the created session', async () => {
    mockReturning.mockResolvedValueOnce([sampleSession]);

    const result = await createChatSession(sampleSession);

    expect(result).toEqual(sampleSession);
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledWith(sampleSession);
  });

  it('throws if no row returned', async () => {
    mockReturning.mockResolvedValueOnce([]);

    await expect(createChatSession(sampleSession)).rejects.toThrow(
      'createChatSession: no row returned',
    );
  });
});

describe('getChatSessionsByUserId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns sessions ordered by updatedAt DESC', async () => {
    mockOrderBy.mockResolvedValueOnce([sampleSession]);

    const result = await getChatSessionsByUserId('user-uuid-1' as UserId);

    expect(result).toEqual([sampleSession]);
  });

  it('returns empty array when user has no sessions', async () => {
    mockOrderBy.mockResolvedValueOnce([]);

    const result = await getChatSessionsByUserId('user-uuid-2' as UserId);

    expect(result).toEqual([]);
  });
});

describe('getChatSessionById', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the session when found', async () => {
    mockLimit.mockResolvedValueOnce([sampleSession]);

    const result = await getChatSessionById('sess-uuid-1' as ChatSessionId);

    expect(result).toEqual(sampleSession);
  });

  it('returns undefined when not found', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const result = await getChatSessionById('nonexistent' as ChatSessionId);

    expect(result).toBeUndefined();
  });
});

describe('touchChatSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls update.set.where without throwing', async () => {
    mocks.mockWhereUpdate.mockResolvedValue(undefined);

    await expect(touchChatSession('sess-uuid-1' as ChatSessionId)).resolves.not.toThrow();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ updatedAt: expect.any(Date) }));
  });
});

describe('deleteChatSession', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls delete.where without throwing', async () => {
    mocks.mockWhereDelete.mockResolvedValue(undefined);

    await expect(deleteChatSession('sess-uuid-1' as ChatSessionId)).resolves.not.toThrow();
    expect(mockDelete).toHaveBeenCalledOnce();
  });
});
