import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const { mockGetCurrentUserId, mockGetSession, mockDeleteSession, mockRevalidate } =
  vi.hoisted(() => ({
    mockGetCurrentUserId: vi.fn(),
    mockGetSession: vi.fn(),
    mockDeleteSession: vi.fn(),
    mockRevalidate: vi.fn(),
  }));

vi.mock('@/lib/auth-helpers', () => ({ getCurrentUserId: mockGetCurrentUserId }));
vi.mock('@/db/queries/chat-sessions', () => ({
  getChatSessionById: mockGetSession,
  deleteChatSession: mockDeleteSession,
}));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }));

import { deleteSessionAction } from '../chat';
import type { ChatSessionId, UserId } from '@/shared/types';

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000' as ChatSessionId;
const USER = { id: 'a17c2f90-1234-4d56-89ab-000000000001' as UserId };
const SESSION = { id: SESSION_ID, userId: USER.id, title: null, createdAt: new Date(), updatedAt: new Date() };

describe('deleteSessionAction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns error when unauthenticated', async () => {
    mockGetCurrentUserId.mockResolvedValue(null);

    const result = await deleteSessionAction(SESSION_ID);

    expect(result).toEqual({ error: 'Unauthorized' });
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });

  it('returns error when session does not exist', async () => {
    mockGetCurrentUserId.mockResolvedValue(USER.id);
    mockGetSession.mockResolvedValue(undefined);

    const result = await deleteSessionAction(SESSION_ID);

    expect(result).toEqual({ error: 'Session not found' });
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });

  it('returns error when session belongs to a different user', async () => {
    mockGetCurrentUserId.mockResolvedValue(USER.id);
    mockGetSession.mockResolvedValue({ ...SESSION, userId: 'other-user-id' });

    const result = await deleteSessionAction(SESSION_ID);

    expect(result).toEqual({ error: 'Forbidden' });
    expect(mockDeleteSession).not.toHaveBeenCalled();
  });

  it('deletes the session and revalidates /chat on success', async () => {
    mockGetCurrentUserId.mockResolvedValue(USER.id);
    mockGetSession.mockResolvedValue(SESSION);
    mockDeleteSession.mockResolvedValue(undefined);

    const result = await deleteSessionAction(SESSION_ID);

    expect(result).toEqual({});
    expect(mockDeleteSession).toHaveBeenCalledWith(SESSION_ID);
    expect(mockRevalidate).toHaveBeenCalledWith('/chat');
  });
});
