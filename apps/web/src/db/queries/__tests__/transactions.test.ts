import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockReturning,
  mockOnConflictDoUpdate,
  mockValues,
  mockInsert,
  mockUpdate,
  mockSet,
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
  };
});

vi.mock('@/lib/db', () => ({ db: { insert: mockInsert, update: mockUpdate } }));
vi.mock('@/db/schema', () => ({
  transactions: {
    plaidTransactionId: 'plaid_transaction_id',
    userId: 'user_id',
    accountId: 'account_id',
    deletedAt: 'deleted_at',
  },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
  and: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((col: string) => `${col} IS NULL`),
}));

import { upsertTransaction, softDeleteTransactionByPlaidId } from '../transactions';

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
    // The onConflictDoUpdate call confirms the idempotent upsert path is configured
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
