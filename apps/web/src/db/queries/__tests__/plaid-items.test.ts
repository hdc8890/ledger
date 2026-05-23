import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReturning, mockValues, mockInsert, mockUpdate, mockSet, mockWhere } = vi.hoisted(
  () => {
    const mockReturning = vi.fn();
    const mockValues = vi.fn(() => ({ returning: mockReturning }));
    const mockInsert = vi.fn(() => ({ values: mockValues }));
    const mockWhere = vi.fn(() => ({ returning: mockReturning }));
    const mockSet = vi.fn(() => ({ where: mockWhere }));
    const mockUpdate = vi.fn(() => ({ set: mockSet }));
    return { mockReturning, mockValues, mockInsert, mockUpdate, mockSet, mockWhere };
  },
);

vi.mock('@/lib/db', () => ({ db: { insert: mockInsert, update: mockUpdate } }));
vi.mock('@/db/schema', () => ({ plaidItems: { userId: 'user_id', id: 'id', cursor: 'cursor' } }));
vi.mock('drizzle-orm', () => ({ eq: vi.fn((col: string, val: string) => `${col}=${val}`) }));

import { insertPlaidItem, updatePlaidItemCursor, updatePlaidItemStatus } from '../plaid-items';

const sample = {
  id: 'item-uuid',
  userId: 'user-uuid',
  accessTokenEnc: 'enc-token',
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
