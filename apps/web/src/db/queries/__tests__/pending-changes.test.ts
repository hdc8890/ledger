import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Drizzle mock — set up before vi.mock factories run.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockLimit = vi.fn();
  // mockWhere has no default return — each test configures the resolution.
  const mockWhere = vi.fn();
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  const mockWhereUpdate = vi.fn();
  const mockSet = vi.fn(() => ({ where: mockWhereUpdate }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));
  return {
    mockReturning,
    mockValues,
    mockInsert,
    mockLimit,
    mockWhere,
    mockFrom,
    mockSelect,
    mockWhereUpdate,
    mockSet,
    mockUpdate,
  };
});

const {
  mockReturning,
  mockValues,
  mockInsert,
  mockLimit,
  mockSet,
  mockUpdate,
} = mocks;

vi.mock('@/lib/db', () => ({
  db: {
    insert: mocks.mockInsert,
    select: mocks.mockSelect,
    update: mocks.mockUpdate,
  },
}));

vi.mock('@/db/schema', () => ({
  pendingChanges: { id: 'id', userId: 'user_id', kind: 'kind', payload: 'payload', status: 'status', appliedAt: 'applied_at' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
}));

import {
  insertPendingChange,
  getPendingChangesByUserId,
  getPendingChangeById,
  applyPendingChange,
  rejectPendingChange,
} from '../pending-changes';
import type { PendingChangeId, UserId } from '@/shared/types';

const USER_ID = 'a17c2f90-1234-4d56-89ab-000000000001' as UserId;
const CHANGE_ID = '550e8400-e29b-41d4-a716-446655440000' as PendingChangeId;

const sampleChange = {
  id: CHANGE_ID,
  userId: USER_ID,
  kind: 'asset_update',
  payload: { field: 'name', value: 'New Name' },
  status: 'pending' as const,
  appliedAt: null,
  createdAt: new Date(),
};

describe('insertPendingChange', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the inserted row', async () => {
    mockReturning.mockResolvedValueOnce([sampleChange]);

    const result = await insertPendingChange({
      userId: USER_ID,
      kind: 'asset_update',
      payload: { field: 'name', value: 'New Name' },
    });

    expect(result).toEqual(sampleChange);
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, kind: 'asset_update' }),
    );
  });

  it('throws if no row returned', async () => {
    mockReturning.mockResolvedValueOnce([]);

    await expect(
      insertPendingChange({ userId: USER_ID, kind: 'asset_update', payload: {} }),
    ).rejects.toThrow('insertPendingChange: no row returned');
  });
});

describe('getPendingChangesByUserId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns changes for the user', async () => {
    mocks.mockWhere.mockResolvedValueOnce([sampleChange]);

    const result = await getPendingChangesByUserId(USER_ID);

    expect(result).toEqual([sampleChange]);
  });

  it('returns empty array when user has no pending changes', async () => {
    mocks.mockWhere.mockResolvedValueOnce([]);

    const result = await getPendingChangesByUserId(USER_ID);

    expect(result).toEqual([]);
  });
});

describe('getPendingChangeById', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the change when found', async () => {
    mocks.mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([sampleChange]);

    const result = await getPendingChangeById(CHANGE_ID);

    expect(result).toEqual(sampleChange);
  });

  it('returns undefined when not found', async () => {
    mocks.mockWhere.mockReturnValueOnce({ limit: mockLimit });
    mockLimit.mockResolvedValueOnce([]);

    const result = await getPendingChangeById(CHANGE_ID);

    expect(result).toBeUndefined();
  });
});

describe('applyPendingChange', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls update.set.where with applied status and appliedAt timestamp', async () => {
    mocks.mockWhereUpdate.mockResolvedValue(undefined);
    const appliedAt = new Date();

    await expect(applyPendingChange(CHANGE_ID, appliedAt)).resolves.not.toThrow();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'applied', appliedAt }),
    );
  });
});

describe('rejectPendingChange', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls update.set.where with rejected status', async () => {
    mocks.mockWhereUpdate.mockResolvedValue(undefined);

    await expect(rejectPendingChange(CHANGE_ID)).resolves.not.toThrow();
    expect(mockUpdate).toHaveBeenCalledOnce();
    expect(mockSet).toHaveBeenCalledWith({ status: 'rejected' });
  });
});
