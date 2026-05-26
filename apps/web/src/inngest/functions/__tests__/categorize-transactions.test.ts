import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockGetTransactionsNeedingCategorization,
  mockUpdateTransactionCategoryEnriched,
  mockGetActiveCategorizationRulesByUserId,
  mockCategorizeBatch,
  mockInsertAuditEvent,
} = vi.hoisted(() => ({
  mockGetTransactionsNeedingCategorization: vi.fn(),
  mockUpdateTransactionCategoryEnriched: vi.fn(),
  mockGetActiveCategorizationRulesByUserId: vi.fn(),
  mockCategorizeBatch: vi.fn(),
  mockInsertAuditEvent: vi.fn(),
}));

vi.mock('@/db/queries/transactions', () => ({
  getTransactionsNeedingCategorization: mockGetTransactionsNeedingCategorization,
  updateTransactionCategoryEnriched: mockUpdateTransactionCategoryEnriched,
}));

vi.mock('@/db/queries/categorization-rules', () => ({
  getActiveCategorizationRulesByUserId: mockGetActiveCategorizationRulesByUserId,
}));

vi.mock('@/lib/enrich/categorize', () => ({
  categorizeBatch: mockCategorizeBatch,
}));

vi.mock('@/db/queries/audit-events', () => ({
  insertAuditEvent: mockInsertAuditEvent,
}));

import {
  handleCategorizeTransactions,
  type CategorizeTransactionsContext,
} from '../categorize-transactions';
import type { TransactionId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep() {
  return {
    run: vi.fn().mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn()),
    sendEvent: vi.fn().mockResolvedValue(undefined),
  };
}

function makeTxn(id: string, merchantNormalized: string | null = null) {
  return {
    id,
    merchantNormalized,
    merchantRaw: merchantNormalized ?? 'SOME MERCHANT',
    userId: 'user-uuid',
    accountId: 'acct-uuid',
    plaidTransactionId: `plaid-${id}`,
    postedAt: '2024-01-15',
    authorizedAt: null,
    amountCents: 2500n,
    currency: 'USD',
    category: 'GENERAL_MERCHANDISE',
    categorySource: 'plaid' as const,
    categoryConfidence: null,
    pending: false,
    source: 'plaid' as const,
    confidence: 1.0,
    isTransfer: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleCategorizeTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateTransactionCategoryEnriched.mockResolvedValue({});
    mockInsertAuditEvent.mockResolvedValue({});
    mockGetActiveCategorizationRulesByUserId.mockResolvedValue([]);
  });

  it('returns zero counts when no transactions need categorization', async () => {
    mockGetTransactionsNeedingCategorization.mockResolvedValue([]);
    mockCategorizeBatch.mockResolvedValue(new Map());

    const ctx: CategorizeTransactionsContext = {
      event: { data: { userId: 'user-uuid' } },
      step: makeStep(),
    };

    const result = await handleCategorizeTransactions(ctx);

    expect(result).toEqual({ userId: 'user-uuid', processed: 0, batches: 1 });
    expect(mockCategorizeBatch).not.toHaveBeenCalled();
    expect(mockUpdateTransactionCategoryEnriched).not.toHaveBeenCalled();
  });

  it('categorizes a batch and writes category + audit event per transaction', async () => {
    const txns = [makeTxn('txn-1', 'Netflix'), makeTxn('txn-2', 'Costco')];
    mockGetTransactionsNeedingCategorization.mockResolvedValueOnce(txns).mockResolvedValueOnce([]);
    mockCategorizeBatch.mockResolvedValue(
      new Map([
        ['txn-1' as TransactionId, { category: 'Streaming & Subscriptions', source: 'rule' as const, confidence: 1.0 }],
        ['txn-2' as TransactionId, { category: 'Groceries', source: 'ai' as const, confidence: 0.93 }],
      ]),
    );

    const ctx: CategorizeTransactionsContext = {
      event: { data: { userId: 'user-uuid' } },
      step: makeStep(),
    };

    const result = await handleCategorizeTransactions(ctx);

    expect(result).toEqual({ userId: 'user-uuid', processed: 2, batches: 2 });
    expect(mockUpdateTransactionCategoryEnriched).toHaveBeenCalledWith('txn-1', 'Streaming & Subscriptions', 'rule', 1.0);
    expect(mockUpdateTransactionCategoryEnriched).toHaveBeenCalledWith('txn-2', 'Groceries', 'ai', 0.93);
    expect(mockInsertAuditEvent).toHaveBeenCalledTimes(2);
  });

  it('loads active rules exactly once before processing batches', async () => {
    const batch1 = Array.from({ length: 50 }, (_, i) => makeTxn(`txn-${i}`));
    const batch2 = [makeTxn('txn-50')];

    mockGetTransactionsNeedingCategorization
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
      .mockResolvedValueOnce([]);

    const batch1Map = new Map(
      batch1.map((t) => [t.id as TransactionId, { category: 'Other', source: 'ai' as const, confidence: 0.5 }]),
    );
    const batch2Map = new Map([['txn-50' as TransactionId, { category: 'Other', source: 'ai' as const, confidence: 0.5 }]]);

    mockCategorizeBatch.mockResolvedValueOnce(batch1Map).mockResolvedValueOnce(batch2Map);

    const ctx: CategorizeTransactionsContext = {
      event: { data: { userId: 'user-uuid' } },
      step: makeStep(),
    };

    const result = await handleCategorizeTransactions(ctx);

    expect(result.processed).toBe(51);
    expect(result.batches).toBe(3);
    // Rules must only be loaded once regardless of batch count.
    expect(mockGetActiveCategorizationRulesByUserId).toHaveBeenCalledOnce();
  });

  it('writes audit source=rule for rule-matched transactions', async () => {
    const txns = [makeTxn('txn-r', 'Netflix')];
    mockGetTransactionsNeedingCategorization.mockResolvedValueOnce(txns).mockResolvedValueOnce([]);
    mockCategorizeBatch.mockResolvedValue(
      new Map([['txn-r' as TransactionId, { category: 'Streaming & Subscriptions', source: 'rule' as const, confidence: 1.0 }]]),
    );

    const ctx: CategorizeTransactionsContext = {
      event: { data: { userId: 'user-uuid' } },
      step: makeStep(),
    };

    await handleCategorizeTransactions(ctx);

    expect(mockInsertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'rule', confidence: 1.0 }),
    );
  });

  it('writes audit source=ai for LLM-matched transactions', async () => {
    const txns = [makeTxn('txn-ai', 'Unknown Merchant')];
    mockGetTransactionsNeedingCategorization.mockResolvedValueOnce(txns).mockResolvedValueOnce([]);
    mockCategorizeBatch.mockResolvedValue(
      new Map([['txn-ai' as TransactionId, { category: 'Other', source: 'ai' as const, confidence: 0.6 }]]),
    );

    const ctx: CategorizeTransactionsContext = {
      event: { data: { userId: 'user-uuid' } },
      step: makeStep(),
    };

    await handleCategorizeTransactions(ctx);

    expect(mockInsertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'ai', confidence: 0.6 }),
    );
  });

  it('skips transactions whose categorize result is missing from the map', async () => {
    const txns = [makeTxn('txn-skip')];
    mockGetTransactionsNeedingCategorization.mockResolvedValueOnce(txns).mockResolvedValueOnce([]);
    // categorizeBatch returns empty map — no result for this transaction.
    mockCategorizeBatch.mockResolvedValue(new Map());

    const ctx: CategorizeTransactionsContext = {
      event: { data: { userId: 'user-uuid' } },
      step: makeStep(),
    };

    const result = await handleCategorizeTransactions(ctx);

    expect(result.processed).toBe(1);
    expect(mockUpdateTransactionCategoryEnriched).not.toHaveBeenCalled();
    expect(mockInsertAuditEvent).not.toHaveBeenCalled();
  });
});
