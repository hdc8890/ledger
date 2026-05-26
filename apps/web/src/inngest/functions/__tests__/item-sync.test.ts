import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — mock factories defined before vi.mock calls
// ---------------------------------------------------------------------------

const {
  mockGetPlaidItemById,
  mockUpdatePlaidItemCursor,
  mockGetAccountsByPlaidItemId,
  mockUpsertAccount,
  mockUpsertTransaction,
  mockSoftDeleteTransactionByPlaidId,
  mockDecryptSecret,
  mockTransactionsSync,
} = vi.hoisted(() => ({
  mockGetPlaidItemById: vi.fn(),
  mockUpdatePlaidItemCursor: vi.fn(),
  mockGetAccountsByPlaidItemId: vi.fn(),
  mockUpsertAccount: vi.fn(),
  mockUpsertTransaction: vi.fn(),
  mockSoftDeleteTransactionByPlaidId: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockTransactionsSync: vi.fn(),
}));

vi.mock('@/db/queries/plaid-items', () => ({
  getPlaidItemById: mockGetPlaidItemById,
  updatePlaidItemCursor: mockUpdatePlaidItemCursor,
}));

vi.mock('@/db/queries/accounts', () => ({
  getAccountsByPlaidItemId: mockGetAccountsByPlaidItemId,
  upsertAccount: mockUpsertAccount,
}));

vi.mock('@/db/queries/transactions', () => ({
  upsertTransaction: mockUpsertTransaction,
  softDeleteTransactionByPlaidId: mockSoftDeleteTransactionByPlaidId,
}));

vi.mock('@/lib/encrypt', () => ({
  decryptSecret: mockDecryptSecret,
}));

vi.mock('@/lib/plaid', () => ({
  plaidClient: { transactionsSync: mockTransactionsSync },
}));

import { handleItemSync, type ItemSyncContext } from '../item-sync';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Make a transparent step mock that runs the callback immediately. */
function makeStep() {
  return {
    run: vi.fn().mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn()),
    sendEvent: vi.fn().mockResolvedValue(undefined),
  };
}

const FAKE_ITEM = {
  id: 'item-uuid-1',
  userId: 'user-uuid-1',
  accessTokenEnc: 'enc-token',
  cursor: null,
  status: 'active',
  plaidItemId: 'plaid-item-1',
  institutionId: 'ins_1',
  institutionName: 'Test Bank',
  lastSyncedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const FAKE_ACCOUNT = {
  id: 'account-uuid-1',
  userId: 'user-uuid-1',
  plaidItemId: 'item-uuid-1',
  plaidAccountId: 'plaid-account-1',
  name: 'Checking',
  officialName: null,
  mask: '1234',
  type: 'depository',
  subtype: 'checking',
  currency: 'USD',
  balanceCurrent: 10000n,
  balanceAvailable: 9500n,
  lastSyncedAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeSyncPage(opts: {
  added?: unknown[];
  modified?: unknown[];
  removed?: unknown[];
  hasMore?: boolean;
  nextCursor?: string;
  accounts?: unknown[];
}) {
  return {
    data: {
      added: opts.added ?? [],
      modified: opts.modified ?? [],
      removed: opts.removed ?? [],
      has_more: opts.hasMore ?? false,
      next_cursor: opts.nextCursor ?? 'cursor-2',
      accounts: opts.accounts ?? [
        {
          account_id: 'plaid-account-1',
          name: 'Checking',
          official_name: null,
          mask: '1234',
          type: 'depository',
          subtype: 'checking',
          balances: {
            current: 100.0,
            available: 95.0,
            iso_currency_code: 'USD',
          },
        },
      ],
    },
  };
}

function makePlaidTransaction(overrides?: Record<string, unknown>) {
  return {
    transaction_id: 'txn-1',
    account_id: 'plaid-account-1',
    amount: 25.5,
    iso_currency_code: 'USD',
    unofficial_currency_code: null,
    date: '2024-01-15',
    authorized_date: '2024-01-14',
    name: 'Coffee Shop',
    merchant_name: 'Starbucks',
    pending: false,
    personal_finance_category: { primary: 'FOOD_AND_DRINK', detailed: 'COFFEE', confidence_level: 'HIGH' },
    category: ['Food and Drink', 'Coffee'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleItemSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptSecret.mockResolvedValue('access-token-plain');
    mockGetAccountsByPlaidItemId.mockResolvedValue([FAKE_ACCOUNT]);
    mockUpsertAccount.mockResolvedValue(FAKE_ACCOUNT);
    mockUpsertTransaction.mockResolvedValue({});
    mockSoftDeleteTransactionByPlaidId.mockResolvedValue(undefined);
    mockUpdatePlaidItemCursor.mockResolvedValue(undefined);
  });

  it('throws NonRetriableError when item is not found', async () => {
    mockGetPlaidItemById.mockResolvedValue(undefined);

    const ctx: ItemSyncContext = {
      event: { data: { itemId: 'missing-id' } },
      step: makeStep(),
    };

    await expect(handleItemSync(ctx)).rejects.toThrow('Plaid item not found: missing-id');
  });

  it('empty sync: no transactions, cursor still updated', async () => {
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);
    mockTransactionsSync.mockResolvedValue(
      makeSyncPage({ added: [], modified: [], removed: [], nextCursor: 'cursor-end' }),
    );

    const ctx: ItemSyncContext = {
      event: { data: { itemId: FAKE_ITEM.id } },
      step: makeStep(),
    };

    const result = await handleItemSync(ctx);

    expect(result).toEqual({ itemId: FAKE_ITEM.id, added: 0, modified: 0, removed: 0 });
    expect(mockUpsertTransaction).not.toHaveBeenCalled();
    expect(mockSoftDeleteTransactionByPlaidId).not.toHaveBeenCalled();
    expect(mockUpdatePlaidItemCursor).toHaveBeenCalledWith(
      FAKE_ITEM.id,
      'cursor-end',
      expect.any(Date),
    );
  });

  it('happy path: processes added, modified, removed transactions', async () => {
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);

    const added = [makePlaidTransaction({ transaction_id: 'txn-add-1' })];
    const modified = [makePlaidTransaction({ transaction_id: 'txn-mod-1' })];
    const removed = [{ transaction_id: 'txn-del-1', account_id: 'plaid-account-1' }];

    mockTransactionsSync.mockResolvedValue(
      makeSyncPage({ added, modified, removed, nextCursor: 'cursor-2' }),
    );

    const ctx: ItemSyncContext = {
      event: { data: { itemId: FAKE_ITEM.id } },
      step: makeStep(),
    };

    const result = await handleItemSync(ctx);

    expect(result).toEqual({ itemId: FAKE_ITEM.id, added: 1, modified: 1, removed: 1 });
    expect(mockUpsertTransaction).toHaveBeenCalledTimes(2);
    expect(mockSoftDeleteTransactionByPlaidId).toHaveBeenCalledOnce();
    expect(mockSoftDeleteTransactionByPlaidId).toHaveBeenCalledWith('txn-del-1', expect.any(Date));
    expect(mockUpdatePlaidItemCursor).toHaveBeenCalledWith(
      FAKE_ITEM.id,
      'cursor-2',
      expect.any(Date),
    );
  });

  it('uses personal_finance_category.primary when available', async () => {
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);

    const added = [makePlaidTransaction({ transaction_id: 'txn-1' })];
    mockTransactionsSync.mockResolvedValue(makeSyncPage({ added }));

    const ctx: ItemSyncContext = {
      event: { data: { itemId: FAKE_ITEM.id } },
      step: makeStep(),
    };

    await handleItemSync(ctx);

    const upsertCall = mockUpsertTransaction.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(upsertCall?.category).toBe('FOOD_AND_DRINK');
    expect(upsertCall?.categorySource).toBe('plaid');
  });

  it('falls back to category array when personal_finance_category is null', async () => {
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);

    const added = [
      makePlaidTransaction({
        transaction_id: 'txn-1',
        personal_finance_category: null,
        category: ['Food and Drink'],
      }),
    ];
    mockTransactionsSync.mockResolvedValue(makeSyncPage({ added }));

    const ctx: ItemSyncContext = {
      event: { data: { itemId: FAKE_ITEM.id } },
      step: makeStep(),
    };

    await handleItemSync(ctx);

    const upsertCall = mockUpsertTransaction.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(upsertCall?.category).toBe('Food and Drink');
    expect(upsertCall?.categorySource).toBeNull();
  });

  it('handles multiple pages (has_more = true on first call)', async () => {
    mockGetPlaidItemById.mockResolvedValue({ ...FAKE_ITEM, cursor: 'cursor-start' });

    mockTransactionsSync
      .mockResolvedValueOnce(
        makeSyncPage({
          added: [makePlaidTransaction({ transaction_id: 'txn-page1' })],
          hasMore: true,
          nextCursor: 'cursor-page2',
        }),
      )
      .mockResolvedValueOnce(
        makeSyncPage({
          added: [makePlaidTransaction({ transaction_id: 'txn-page2' })],
          hasMore: false,
          nextCursor: 'cursor-page3',
        }),
      );

    const ctx: ItemSyncContext = {
      event: { data: { itemId: FAKE_ITEM.id } },
      step: makeStep(),
    };

    const result = await handleItemSync(ctx);

    expect(mockTransactionsSync).toHaveBeenCalledTimes(2);
    expect(result.added).toBe(2);
    // Second call should use the cursor from first page
    expect(mockTransactionsSync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: 'cursor-page2' }),
    );
    // Final cursor persisted
    expect(mockUpdatePlaidItemCursor).toHaveBeenCalledWith(
      FAKE_ITEM.id,
      'cursor-page3',
      expect.any(Date),
    );
  });

  it('skips transactions for unknown account IDs', async () => {
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);
    // accountMap will only know about plaid-account-1
    // but the transaction references a different account
    const added = [makePlaidTransaction({ transaction_id: 'txn-1', account_id: 'unknown-acct' })];
    mockTransactionsSync.mockResolvedValue(
      makeSyncPage({
        added,
        accounts: [], // no accounts in sync response either
      }),
    );

    const ctx: ItemSyncContext = {
      event: { data: { itemId: FAKE_ITEM.id } },
      step: makeStep(),
    };

    const result = await handleItemSync(ctx);

    // Transaction was skipped (unknown account), count stays 0
    expect(result.added).toBe(0);
    expect(mockUpsertTransaction).not.toHaveBeenCalled();
  });

  it('uses initial cursor from item when present', async () => {
    mockGetPlaidItemById.mockResolvedValue({ ...FAKE_ITEM, cursor: 'existing-cursor' });
    mockTransactionsSync.mockResolvedValue(makeSyncPage({}));

    const ctx: ItemSyncContext = {
      event: { data: { itemId: FAKE_ITEM.id } },
      step: makeStep(),
    };

    await handleItemSync(ctx);

    expect(mockTransactionsSync).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: 'existing-cursor' }),
    );
  });

  it('omits cursor on first sync (null cursor)', async () => {
    mockGetPlaidItemById.mockResolvedValue({ ...FAKE_ITEM, cursor: null });
    mockTransactionsSync.mockResolvedValue(makeSyncPage({}));

    const ctx: ItemSyncContext = {
      event: { data: { itemId: FAKE_ITEM.id } },
      step: makeStep(),
    };

    await handleItemSync(ctx);

    // cursor key should not appear in the request object
    const callArg = mockTransactionsSync.mock.calls[0]?.[0] as Record<string, unknown>;
    expect('cursor' in callArg).toBe(false);
  });

  it('propagates Plaid API errors so Inngest can retry the step', async () => {
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);
    mockGetAccountsByPlaidItemId.mockResolvedValue([FAKE_ACCOUNT]);
    mockDecryptSecret.mockResolvedValue('access-token-plain');
    const plaidError = Object.assign(new Error('Plaid rate limit'), {
      response: { data: { error_code: 'RATE_LIMIT_EXCEEDED' } },
    });
    mockTransactionsSync.mockRejectedValue(plaidError);

    const ctx: ItemSyncContext = {
      event: { data: { itemId: FAKE_ITEM.id } },
      step: makeStep(),
    };

    await expect(handleItemSync(ctx)).rejects.toThrow('Plaid rate limit');
  });
});
