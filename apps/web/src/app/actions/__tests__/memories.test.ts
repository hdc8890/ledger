import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemoryId, UserId } from '@/shared/types';
import type { MemoryRow } from '@/db/queries/memories';

// ---------------------------------------------------------------------------
// Mocks (hoisted — must be before imports of the module under test)
// ---------------------------------------------------------------------------
const {
  mockGetCurrentUserId,
  mockDeleteAllMemories,
  mockDeleteMemory,
  mockUpdateMemoryText,
  mockListMemories,
  mockInsertAuditEvent,
  mockRevalidate,
} = vi.hoisted(() => ({
  mockGetCurrentUserId: vi.fn(),
  mockDeleteAllMemories: vi.fn(),
  mockDeleteMemory: vi.fn(),
  mockUpdateMemoryText: vi.fn(),
  mockListMemories: vi.fn(),
  mockInsertAuditEvent: vi.fn(),
  mockRevalidate: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }));
vi.mock('@/lib/auth-helpers', () => ({ getCurrentUserId: mockGetCurrentUserId }));
vi.mock('@/db/queries/memories', () => ({
  deleteAllMemories: mockDeleteAllMemories,
}));
vi.mock('@/db/queries/audit-events', () => ({
  insertAuditEvent: mockInsertAuditEvent,
}));
vi.mock('@/ai/memory', () => ({
  deleteMemory: mockDeleteMemory,
  updateMemoryText: mockUpdateMemoryText,
  listMemories: mockListMemories,
}));

import {
  updateMemoryAction,
  deleteMemoryAction,
  clearAllMemoriesAction,
  getMemoriesAction,
} from '../memories';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const USER_ID = 'user-uuid-001' as UserId;
const MEMORY_ID = 'memory-uuid-001' as MemoryId;

const SAMPLE_MEMORY: MemoryRow = {
  id: MEMORY_ID,
  userId: USER_ID,
  kind: 'household_rule',
  text: 'Costco should be Groceries',
  embedding: null,
  confidence: 1.0,
  metadata: {},
  expiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentUserId.mockResolvedValue(USER_ID);
  mockInsertAuditEvent.mockResolvedValue({ id: 'audit-uuid' });
});

// ---------------------------------------------------------------------------
// updateMemoryAction
// ---------------------------------------------------------------------------
describe('updateMemoryAction', () => {
  beforeEach(() => {
    mockUpdateMemoryText.mockResolvedValue({ ...SAMPLE_MEMORY, text: 'new text' });
  });

  it('returns {} and revalidates on success', async () => {
    const result = await updateMemoryAction(MEMORY_ID, 'Amazon should be Shopping');
    expect(result).toEqual({});
    expect(mockUpdateMemoryText).toHaveBeenCalledWith(USER_ID, MEMORY_ID, 'Amazon should be Shopping');
    expect(mockRevalidate).toHaveBeenCalledWith('/settings/memory');
  });

  it('trims whitespace from the new text', async () => {
    await updateMemoryAction(MEMORY_ID, '  trimmed text  ');
    expect(mockUpdateMemoryText).toHaveBeenCalledWith(USER_ID, MEMORY_ID, 'trimmed text');
  });

  it('returns Unauthorized when unauthenticated', async () => {
    mockGetCurrentUserId.mockResolvedValueOnce(null);
    expect(await updateMemoryAction(MEMORY_ID, 'new text')).toEqual({ error: 'Unauthorized' });
    expect(mockUpdateMemoryText).not.toHaveBeenCalled();
  });

  it('returns error when text is empty', async () => {
    expect(await updateMemoryAction(MEMORY_ID, '   ')).toEqual({
      error: 'Memory text cannot be empty',
    });
    expect(mockUpdateMemoryText).not.toHaveBeenCalled();
  });

  it('returns Memory not found when updateMemoryText returns undefined', async () => {
    mockUpdateMemoryText.mockResolvedValueOnce(undefined);
    expect(await updateMemoryAction(MEMORY_ID, 'some text')).toEqual({ error: 'Memory not found' });
  });

  it('returns validation error message when updateMemoryText throws', async () => {
    mockUpdateMemoryText.mockRejectedValueOnce(new Error('contains raw dollar amount'));
    const result = await updateMemoryAction(MEMORY_ID, '$1,234.56');
    expect(result).toEqual({ error: 'contains raw dollar amount' });
  });
});

// ---------------------------------------------------------------------------
// deleteMemoryAction
// ---------------------------------------------------------------------------
describe('deleteMemoryAction', () => {
  beforeEach(() => {
    mockDeleteMemory.mockResolvedValue(undefined);
  });

  it('returns {} and revalidates on success', async () => {
    const result = await deleteMemoryAction(MEMORY_ID);
    expect(result).toEqual({});
    expect(mockDeleteMemory).toHaveBeenCalledWith(USER_ID, MEMORY_ID);
    expect(mockRevalidate).toHaveBeenCalledWith('/settings/memory');
  });

  it('returns Unauthorized when unauthenticated', async () => {
    mockGetCurrentUserId.mockResolvedValueOnce(null);
    expect(await deleteMemoryAction(MEMORY_ID)).toEqual({ error: 'Unauthorized' });
    expect(mockDeleteMemory).not.toHaveBeenCalled();
  });

  it('returns error message when deleteMemory throws', async () => {
    mockDeleteMemory.mockRejectedValueOnce(new Error('DB error'));
    expect(await deleteMemoryAction(MEMORY_ID)).toEqual({ error: 'DB error' });
  });
});

// ---------------------------------------------------------------------------
// clearAllMemoriesAction
// ---------------------------------------------------------------------------
describe('clearAllMemoriesAction', () => {
  beforeEach(() => {
    mockDeleteAllMemories.mockResolvedValue(undefined);
    mockListMemories.mockResolvedValue([SAMPLE_MEMORY]);
  });

  it('returns {} and revalidates on success', async () => {
    const result = await clearAllMemoriesAction();
    expect(result).toEqual({});
    expect(mockListMemories).toHaveBeenCalledWith(USER_ID, undefined, 1000, 0);
    expect(mockDeleteAllMemories).toHaveBeenCalledWith(USER_ID);
    expect(mockInsertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: USER_ID,
        action: 'memory.bulk_delete',
        entityType: 'user',
        entityId: USER_ID,
        before: { count: 1 },
        after: null,
        source: 'user',
      }),
    );
    expect(mockRevalidate).toHaveBeenCalledWith('/settings/memory');
  });

  it('returns Unauthorized when unauthenticated', async () => {
    mockGetCurrentUserId.mockResolvedValueOnce(null);
    expect(await clearAllMemoriesAction()).toEqual({ error: 'Unauthorized' });
    expect(mockDeleteAllMemories).not.toHaveBeenCalled();
  });

  it('returns error message when deleteAllMemories throws', async () => {
    mockDeleteAllMemories.mockRejectedValueOnce(new Error('DB offline'));
    expect(await clearAllMemoriesAction()).toEqual({ error: 'DB offline' });
  });
});

// ---------------------------------------------------------------------------
// getMemoriesAction
// ---------------------------------------------------------------------------
describe('getMemoriesAction', () => {
  beforeEach(() => {
    mockListMemories.mockResolvedValue([SAMPLE_MEMORY]);
  });

  it('returns memories for authenticated user', async () => {
    const result = await getMemoriesAction();
    expect(result).toEqual({ memories: [SAMPLE_MEMORY] });
    expect(mockListMemories).toHaveBeenCalledWith(USER_ID, undefined, 500, 0);
  });

  it('returns Unauthorized when unauthenticated', async () => {
    mockGetCurrentUserId.mockResolvedValueOnce(null);
    expect(await getMemoriesAction()).toEqual({ error: 'Unauthorized' });
    expect(mockListMemories).not.toHaveBeenCalled();
  });

  it('returns empty array when user has no memories', async () => {
    mockListMemories.mockResolvedValueOnce([]);
    const result = await getMemoriesAction();
    expect(result).toEqual({ memories: [] });
  });
});
