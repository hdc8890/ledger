import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserId, TransactionId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------
const {
  mockGetCurrentUserId,
  mockGetTxn,
  mockUpdateTxnCategory,
  mockInsertRule,
  mockRetagMerchant,
  mockInsertAudit,
  mockDbTransaction,
  mockRevalidate,
  mockSaveMemory,
} = vi.hoisted(() => ({
  mockGetCurrentUserId: vi.fn(),
  mockGetTxn: vi.fn(),
  mockUpdateTxnCategory: vi.fn(),
  mockInsertRule: vi.fn(),
  mockRetagMerchant: vi.fn(),
  mockInsertAudit: vi.fn(),
  mockDbTransaction: vi.fn(),
  mockRevalidate: vi.fn(),
  mockSaveMemory: vi.fn(),
}));

vi.mock('@/lib/auth-helpers', () => ({ getCurrentUserId: mockGetCurrentUserId }));
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidate }));
vi.mock('@/db/queries/transactions', () => ({
  getTransactionById: mockGetTxn,
  updateTransactionCategory: mockUpdateTxnCategory,
  retagSameMerchantTransactions: mockRetagMerchant,
}));
vi.mock('@/db/queries/categorization-rules', () => ({
  insertCategorizationRule: mockInsertRule,
}));
vi.mock('@/db/queries/audit-events', () => ({
  insertAuditEvent: mockInsertAudit,
}));
vi.mock('@/ai/memory', () => ({
  saveMemory: mockSaveMemory,
}));
vi.mock('@/lib/db', () => ({
  db: {
    transaction: (fn: (tx: unknown) => Promise<void>) => mockDbTransaction(fn),
  },
}));

import { correctCategoryAction } from '../transactions';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const USER_ID = 'user-uuid-001' as UserId;
const TXN_ID = 'txn-uuid-001' as TransactionId;

const SAMPLE_TXN = {
  id: TXN_ID,
  userId: USER_ID,
  merchantRaw: 'NETFLIX.COM',
  merchantNormalized: 'Netflix',
  category: 'Entertainment',
  categorySource: 'ai' as const,
  categoryConfidence: 0.9,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('correctCategoryAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentUserId.mockResolvedValue(USER_ID);
    mockGetTxn.mockResolvedValue(SAMPLE_TXN);
    mockDbTransaction.mockImplementation((fn: (tx: unknown) => Promise<void>) => fn({}));
    mockUpdateTxnCategory.mockResolvedValue({ ...SAMPLE_TXN, category: 'Streaming & Subscriptions', categorySource: 'user' });
    mockInsertRule.mockResolvedValue({ id: 'rule-uuid', userId: USER_ID, predicate: {}, setCategory: '' });
    mockRetagMerchant.mockResolvedValue(3);
    mockInsertAudit.mockResolvedValue({ id: 'audit-uuid' });
    mockSaveMemory.mockResolvedValue({ id: 'memory-uuid' });
  });

  it('returns {} and revalidates on success', async () => {
    const result = await correctCategoryAction(TXN_ID, 'Streaming & Subscriptions');

    expect(result).toEqual({});
    expect(mockUpdateTxnCategory).toHaveBeenCalledWith(TXN_ID, 'Streaming & Subscriptions', 'user');
    expect(mockInsertRule).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        predicate: { merchant_contains: 'Netflix' },
        setCategory: 'Streaming & Subscriptions',
      }),
    );
    expect(mockRetagMerchant).toHaveBeenCalledWith(USER_ID, 'Netflix', 'Streaming & Subscriptions');
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: USER_ID,
        action: 'txn.category_correct',
        entityType: 'transaction',
        entityId: TXN_ID,
      }),
    );
    expect(mockSaveMemory).toHaveBeenCalledWith(
      USER_ID,
      'household_rule',
      'Netflix transactions should be categorized as Streaming & Subscriptions',
      expect.objectContaining({ source_txn_id: TXN_ID }),
    );
    expect(mockRevalidate).toHaveBeenCalledWith('/transactions');
    expect(mockRevalidate).toHaveBeenCalledWith('/cash-flow');
    expect(mockRevalidate).toHaveBeenCalledWith('/dashboard');
  });

  it('succeeds even when saveMemory throws (best-effort)', async () => {
    mockSaveMemory.mockRejectedValueOnce(new Error('OpenAI down'));
    const result = await correctCategoryAction(TXN_ID, 'Streaming & Subscriptions');
    expect(result).toEqual({});
    expect(mockRevalidate).toHaveBeenCalledWith('/transactions');
  });

  it('uses merchantRaw when merchantNormalized is null', async () => {
    mockGetTxn.mockResolvedValue({ ...SAMPLE_TXN, merchantNormalized: null });
    await correctCategoryAction(TXN_ID, 'Streaming & Subscriptions');
    expect(mockInsertRule).toHaveBeenCalledWith(
      expect.objectContaining({ predicate: { merchant_contains: 'NETFLIX.COM' } }),
    );
    expect(mockRetagMerchant).toHaveBeenCalledWith(USER_ID, 'NETFLIX.COM', 'Streaming & Subscriptions');
  });

  it('returns error when unauthenticated', async () => {
    mockGetCurrentUserId.mockResolvedValue(null);
    const result = await correctCategoryAction(TXN_ID, 'Groceries');
    expect(result).toEqual({ error: 'Unauthorized' });
    expect(mockDbTransaction).not.toHaveBeenCalled();
  });

  it('returns error for invalid category', async () => {
    const result = await correctCategoryAction(TXN_ID, 'NotACategory');
    expect(result).toEqual({ error: 'Invalid category' });
    expect(mockGetTxn).not.toHaveBeenCalled();
  });

  it('returns error when transaction not found', async () => {
    mockGetTxn.mockResolvedValue(undefined);
    const result = await correctCategoryAction(TXN_ID, 'Groceries');
    expect(result).toEqual({ error: 'Transaction not found' });
  });

  it('returns error when transaction belongs to another user', async () => {
    mockGetTxn.mockResolvedValue({ ...SAMPLE_TXN, userId: 'other-user-uuid' });
    const result = await correctCategoryAction(TXN_ID, 'Groceries');
    expect(result).toEqual({ error: 'Forbidden' });
  });

  it('returns error when db.transaction throws', async () => {
    mockDbTransaction.mockRejectedValue(new Error('DB error'));
    const result = await correctCategoryAction(TXN_ID, 'Groceries');
    expect(result).toEqual({ error: 'DB error' });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });
});
