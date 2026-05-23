import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockReturning,
  mockValues,
  mockInsert,
  mockUpdate,
  mockSet,
  mockLimit,
  mockSelectWhere,
  mockSelect,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockWhere = vi.fn(() => ({ returning: mockReturning }));
  const mockSet = vi.fn(() => ({ where: mockWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));
  const mockLimit = vi.fn();
  const mockSelectWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn(() => ({ where: mockSelectWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return {
    mockReturning,
    mockValues,
    mockInsert,
    mockUpdate,
    mockSet,
    mockLimit,
    mockSelectWhere,
    mockSelect,
  };
});

vi.mock('@/lib/db', () => ({
  db: { insert: mockInsert, update: mockUpdate, select: mockSelect },
}));
vi.mock('@/db/schema', () => ({
  plaidItems: { userId: 'user_id', id: 'id', cursor: 'cursor', plaidItemId: 'plaid_item_id' },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn((col: string, val: string) => `${col}=${val}`) }));

import {
  insertPlaidItem,
  updatePlaidItemCursor,
  updatePlaidItemStatus,
  getPlaidItemByPlaidItemId,
} from '../plaid-items';

const sample = {
  id: 'item-uuid',
  userId: 'user-uuid',
  accessTokenEnc: 'enc-token',
  plaidItemId: 'plaid-item-abc',
  institutionId: 'ins_1',
  institutionName: 'Test Bank',
  status: 'active' as const,
  cursor: null,
  lastSyncedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('insertPlaidItem', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the inserted row', async () => {
    mockReturning.mockResolvedValueOnce([sample]);
    const result = await insertPlaidItem(sample);
    expect(result).toEqual(sample);
    expect(mockValues).toHaveBeenCalledWith(sample);
  });

  it('throws if no row returned', async () => {
    mockReturning.mockResolvedValueOnce([]);
    await expect(insertPlaidItem(sample)).rejects.toThrow('insertPlaidItem: no row returned');
  });
});

describe('updatePlaidItemCursor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls update with cursor and lastSyncedAt', async () => {
    const at = new Date('2024-01-01');
    await updatePlaidItemCursor('item-uuid' as import('@/shared/types').PlaidItemId, 'cur123', at);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'cur123', lastSyncedAt: at }),
    );
  });
});

describe('updatePlaidItemStatus', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls update with the provided status', async () => {
    await updatePlaidItemStatus(
      'item-uuid' as import('@/shared/types').PlaidItemId,
      'disconnected',
    );
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'disconnected' }));
  });
});

describe('getPlaidItemByPlaidItemId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the row when found', async () => {
    mockLimit.mockResolvedValueOnce([sample]);
    const result = await getPlaidItemByPlaidItemId('plaid-item-abc');
    expect(result).toEqual(sample);
    expect(mockSelectWhere).toHaveBeenCalledWith('plaid_item_id=plaid-item-abc');
    expect(mockLimit).toHaveBeenCalledWith(1);
  });

  it('returns undefined when not found', async () => {
    mockLimit.mockResolvedValueOnce([]);
    const result = await getPlaidItemByPlaidItemId('unknown-id');
    expect(result).toBeUndefined();
  });
});
