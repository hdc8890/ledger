import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockReturning,
  mockOnConflictDoUpdate,
  mockValues,
  mockInsert,
  mockUpdate,
  mockSet,
  mockWhere,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }));
  const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockWhere = vi.fn(() => ({ returning: mockReturning }));
  const mockSet = vi.fn(() => ({ where: mockWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));
  return {
    mockReturning,
    mockOnConflictDoUpdate,
    mockValues,
    mockInsert,
    mockUpdate,
    mockSet,
    mockWhere,
  };
});

vi.mock('@/lib/db', () => ({ db: { insert: mockInsert, update: mockUpdate } }));
vi.mock('@/db/schema', () => ({
  accounts: { plaidAccountId: 'plaid_account_id', userId: 'user_id', plaidItemId: 'plaid_item_id' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((col: string) => `${col} IS NULL`),
}));

import { upsertAccount, softDeleteAccountsByPlaidItemId } from '../accounts';

const sample = {
  id: 'acct-uuid',
  userId: 'user-uuid',
  plaidItemId: 'item-uuid',
  plaidAccountId: 'plaid-acct-123',
  name: 'Checking',
  officialName: null,
  mask: '0001',
  type: 'depository',
  subtype: 'checking',
  currency: 'USD',
  balanceCurrent: 100000n,
  balanceAvailable: 95000n,
  lastSyncedAt: new Date(),
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('upsertAccount', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the upserted row', async () => {
    mockReturning.mockResolvedValueOnce([sample]);
    const result = await upsertAccount(sample);
    expect(result).toEqual(sample);
    expect(mockValues).toHaveBeenCalledWith(sample);
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'plaid_account_id' }),
    );
  });

  it('throws if no row returned', async () => {
    mockReturning.mockResolvedValueOnce([]);
    await expect(upsertAccount(sample)).rejects.toThrow('upsertAccount: no row returned');
  });
});

describe('softDeleteAccountsByPlaidItemId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets deletedAt and updatedAt', async () => {
    const at = new Date('2024-06-01');
    await softDeleteAccountsByPlaidItemId(
      'item-uuid' as import('@/shared/types').PlaidItemId,
      at,
    );
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: at, updatedAt: at }),
    );
  });
});
