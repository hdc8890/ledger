import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserId } from '@/shared/types';

const {
  mockReturning,
  mockOnConflictDoUpdate,
  mockValues,
  mockInsert,
  mockUpdate,
  mockSet,
  mockOffset,
  mockLimit,
  mockOrderBy,
  mockSelectWhere,
  mockInnerJoin,
  mockFrom,
  mockSelect,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }));
  const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockWhere = vi.fn(() => ({ returning: mockReturning }));
  const mockSet = vi.fn(() => ({ where: mockWhere }));
  const mockUpdate = vi.fn(() => ({ set: mockSet }));

  const mockOffset = vi.fn();
  const mockLimit = vi.fn(() => ({ offset: mockOffset }));
  const mockOrderBy = vi.fn(() => ({ limit: mockLimit }));
  const mockSelectWhere = vi.fn(() => ({ orderBy: mockOrderBy }));
  const mockInnerJoin = vi.fn(() => ({ where: mockSelectWhere }));
  const mockFrom = vi.fn(() => ({ innerJoin: mockInnerJoin }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  return {
    mockReturning,
    mockOnConflictDoUpdate,
    mockValues,
    mockInsert,
    mockUpdate,
    mockSet,
    mockOffset,
    mockLimit,
    mockOrderBy,
    mockSelectWhere,
    mockInnerJoin,
    mockFrom,
    mockSelect,
  };
});

vi.mock('@/lib/db', () => ({
  db: { insert: mockInsert, update: mockUpdate, select: mockSelect },
}));
vi.mock('@/db/schema', () => ({
  transactions: {
    plaidTransactionId: 'plaid_transaction_id',
    userId: 'user_id',
    accountId: 'account_id',
    deletedAt: 'deleted_at',
    merchantNormalized: 'merchant_normalized',
    merchantRaw: 'merchant_raw',
    categorySource: 'category_source',
  },
  accounts: { name: 'name', id: 'id' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((col: string) => `${col} IS NULL`),
  inArray: vi.fn((col: string, vals: unknown[]) => `${col} IN ${JSON.stringify(vals)}`),
  sql: Object.assign(vi.fn((...args: unknown[]) => args), { raw: vi.fn() }),
  desc: vi.fn((col: string) => `${col} DESC`),
  getTableColumns: vi.fn(() => ({ id: 'id', userId: 'user_id' })),
  gte: vi.fn(),
  gt: vi.fn(),
  lt: vi.fn(),
  lte: vi.fn(),
}));

import {
  upsertTransaction,
  softDeleteTransactionByPlaidId,
  getTransactionsForListView,
  retagSameMerchantTransactions,
} from '../transactions';

const sample = {
  id: 'txn-uuid',
  userId: 'user-uuid',
  accountId: 'acct-uuid',
  plaidTransactionId: 'plaid-txn-abc',
  postedAt: '2024-01-15',
  authorizedAt: '2024-01-14',
  amountCents: 2500n,
  currency: 'USD',
  merchantRaw: 'STARBUCKS #1234',
  merchantNormalized: null,
  category: null,
  categorySource: null,
  categoryConfidence: null,
  pending: false,
  source: 'plaid' as const,
  confidence: 1.0,
  isTransfer: false,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('upsertTransaction', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the upserted row', async () => {
    mockReturning.mockResolvedValueOnce([sample]);
    const result = await upsertTransaction(sample);
    expect(result).toEqual(sample);
    expect(mockValues).toHaveBeenCalledWith(sample);
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'plaid_transaction_id' }),
    );
  });

  it('throws if no row returned', async () => {
    mockReturning.mockResolvedValueOnce([]);
    await expect(upsertTransaction(sample)).rejects.toThrow('upsertTransaction: no row returned');
  });

  it('idempotency: re-calling with same plaid id hits conflict path', async () => {
    mockReturning.mockResolvedValueOnce([sample]);
    await upsertTransaction(sample);
    expect(mockOnConflictDoUpdate).toHaveBeenCalledOnce();
  });
});

describe('softDeleteTransactionByPlaidId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets deletedAt and updatedAt to the provided timestamp', async () => {
    const at = new Date('2024-03-01');
    await softDeleteTransactionByPlaidId('plaid-txn-abc', at);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ deletedAt: at, updatedAt: at }),
    );
  });
});

describe('getTransactionsForListView', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns transaction rows with accountName', async () => {
    const rows = [{ ...sample, accountName: 'Checking' }];
    mockOffset.mockResolvedValueOnce(rows);

    const result = await getTransactionsForListView('user-uuid' as UserId, { limit: 10, offset: 0 });

    expect(result).toEqual(rows);
    expect(mockSelect).toHaveBeenCalled();
    expect(mockFrom).toHaveBeenCalled();
    expect(mockInnerJoin).toHaveBeenCalled();
    expect(mockSelectWhere).toHaveBeenCalled();
    expect(mockOrderBy).toHaveBeenCalled();
    expect(mockLimit).toHaveBeenCalledWith(10);
    expect(mockOffset).toHaveBeenCalledWith(0);
  });

  it('uses default limit of 50 and offset 0 when not specified', async () => {
    mockOffset.mockResolvedValueOnce([]);
    await getTransactionsForListView('user-uuid' as UserId);
    expect(mockLimit).toHaveBeenCalledWith(50);
    expect(mockOffset).toHaveBeenCalledWith(0);
  });
});

describe('retagSameMerchantTransactions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates transactions and returns the count of rows changed', async () => {
    const rows = [{ id: 'txn-1' }, { id: 'txn-2' }];
    mockReturning.mockResolvedValueOnce(rows);

    const count = await retagSameMerchantTransactions(
      'user-uuid' as UserId,
      'Netflix',
      'Streaming & Subscriptions',
    );

    expect(count).toBe(2);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'Streaming & Subscriptions',
        categorySource: 'user',
        categoryConfidence: 1.0,
      }),
    );
  });

  it('returns 0 when no matching rows are found', async () => {
    mockReturning.mockResolvedValueOnce([]);
    const count = await retagSameMerchantTransactions('user-uuid' as UserId, 'Unknown', 'Other');
    expect(count).toBe(0);
  });
});

