import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockGetTransactionsNeedingNormalization,
  mockUpdateTransactionMerchantNormalized,
  mockNormalizeMerchantBatch,
  mockInsertAuditEvent,
} = vi.hoisted(() => ({
  mockGetTransactionsNeedingNormalization: vi.fn(),
  mockUpdateTransactionMerchantNormalized: vi.fn(),
  mockNormalizeMerchantBatch: vi.fn(),
  mockInsertAuditEvent: vi.fn(),
}));

vi.mock('@/db/queries/transactions', () => ({
  getTransactionsNeedingNormalization: mockGetTransactionsNeedingNormalization,
  updateTransactionMerchantNormalized: mockUpdateTransactionMerchantNormalized,
}));

vi.mock('@/lib/enrich/merchant-normalize', () => ({
  normalizeMerchantBatch: mockNormalizeMerchantBatch,
}));

vi.mock('@/db/queries/audit-events', () => ({
  insertAuditEvent: mockInsertAuditEvent,
}));

import { handleEnrichTransactions, type EnrichTransactionsContext } from '../enrich-transactions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep() {
  return {
    run: vi.fn().mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn()),
    sendEvent: vi.fn().mockResolvedValue({}),
  };
}

function makeTxn(id: string, merchantRaw: string) {
  return {
    id,
    merchantRaw,
    merchantNormalized: null,
    userId: 'user-uuid',
    accountId: 'acct-uuid',
    postedAt: '2024-01-15',
    amountCents: 2500n,
    currency: 'USD',
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

describe('handleEnrichTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateTransactionMerchantNormalized.mockResolvedValue({});
    mockInsertAuditEvent.mockResolvedValue({});
  });

  it('returns zero counts when no transactions need normalization', async () => {
    mockGetTransactionsNeedingNormalization.mockResolvedValue([]);
    mockNormalizeMerchantBatch.mockResolvedValue(new Map());

    const ctx: EnrichTransactionsContext = {
      event: { data: { userId: 'user-uuid' } },
      step: makeStep(),
    };

    const result = await handleEnrichTransactions(ctx);

    expect(result).toEqual({ userId: 'user-uuid', processed: 0, batches: 1 });
    expect(mockNormalizeMerchantBatch).not.toHaveBeenCalled();
    expect(mockUpdateTransactionMerchantNormalized).not.toHaveBeenCalled();
  });

  it('normalizes a batch of transactions and writes merchant_normalized', async () => {
    const txns = [makeTxn('txn-1', 'STARBUCKS'), makeTxn('txn-2', 'NETFLIX.COM')];
    mockGetTransactionsNeedingNormalization.mockResolvedValueOnce(txns).mockResolvedValueOnce([]);
    mockNormalizeMerchantBatch.mockResolvedValue(
      new Map([
        ['STARBUCKS', { canonical: 'Starbucks', source: 'rule' as const, categoryHint: null }],
        ['NETFLIX.COM', { canonical: 'Netflix', source: 'rule' as const, categoryHint: 'Subscriptions' }],
      ]),
    );

    const ctx: EnrichTransactionsContext = {
      event: { data: { userId: 'user-uuid' } },
      step: makeStep(),
    };

    const result = await handleEnrichTransactions(ctx);

    expect(result).toEqual({ userId: 'user-uuid', processed: 2, batches: 2 });
    expect(mockUpdateTransactionMerchantNormalized).toHaveBeenCalledWith('txn-1', 'Starbucks');
    expect(mockUpdateTransactionMerchantNormalized).toHaveBeenCalledWith('txn-2', 'Netflix');
  });

  it('processes multiple batches until no more transactions remain', async () => {
    const batch1 = Array.from({ length: 50 }, (_, i) =>
      makeTxn(`txn-${i}`, `MERCHANT ${i}`),
    );
    const batch2 = [makeTxn('txn-50', 'LAST MERCHANT')];

    mockGetTransactionsNeedingNormalization
      .mockResolvedValueOnce(batch1)
      .mockResolvedValueOnce(batch2)
      .mockResolvedValueOnce([]);

    const batch1Map = new Map(
      batch1.map((t) => [t.merchantRaw, { canonical: t.merchantRaw, source: 'ai' as const, categoryHint: null }]),
    );
    const batch2Map = new Map([['LAST MERCHANT', { canonical: 'Last Merchant', source: 'ai' as const, categoryHint: null }]]);

    mockNormalizeMerchantBatch
      .mockResolvedValueOnce(batch1Map)
      .mockResolvedValueOnce(batch2Map);

    const ctx: EnrichTransactionsContext = {
      event: { data: { userId: 'user-uuid' } },
      step: makeStep(),
    };

    const result = await handleEnrichTransactions(ctx);

    expect(result.processed).toBe(51);
    expect(result.batches).toBe(3);
  });

  it('skips transactions whose normalization result is missing from the map', async () => {
    const txns = [makeTxn('txn-x', 'UNKNOWN MERCHANT')];
    mockGetTransactionsNeedingNormalization
      .mockResolvedValueOnce(txns)
      .mockResolvedValueOnce([]);
    // Normalize returns empty map for this merchant.
    mockNormalizeMerchantBatch.mockResolvedValue(new Map());

    const ctx: EnrichTransactionsContext = {
      event: { data: { userId: 'user-uuid' } },
      step: makeStep(),
    };

    const result = await handleEnrichTransactions(ctx);

    expect(result.processed).toBe(1);
    expect(mockUpdateTransactionMerchantNormalized).not.toHaveBeenCalled();
  });
});
