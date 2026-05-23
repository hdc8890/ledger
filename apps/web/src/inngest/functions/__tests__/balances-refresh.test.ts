import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — mock factories defined before vi.mock calls
// ---------------------------------------------------------------------------

const {
  mockGetAllActivePlaidItems,
  mockGetPlaidItemById,
  mockDecryptSecret,
  mockAccountsGet,
  mockUpsertAccount,
} = vi.hoisted(() => ({
  mockGetAllActivePlaidItems: vi.fn(),
  mockGetPlaidItemById: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockAccountsGet: vi.fn(),
  mockUpsertAccount: vi.fn(),
}));

vi.mock('@/db/queries/plaid-items', () => ({
  getAllActivePlaidItems: mockGetAllActivePlaidItems,
  getPlaidItemById: mockGetPlaidItemById,
}));

vi.mock('@/lib/encrypt', () => ({
  decryptSecret: mockDecryptSecret,
}));

vi.mock('@/lib/plaid', () => ({
  plaidClient: { accountsGet: mockAccountsGet },
}));

vi.mock('@/db/queries/accounts', () => ({
  upsertAccount: mockUpsertAccount,
}));

import { handleBalancesRefresh, type BalancesRefreshContext } from '../balances-refresh';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep() {
  return {
    run: vi.fn().mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn()),
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

const FAKE_PLAID_ACCOUNTS = [
  {
    account_id: 'plaid-account-1',
    name: 'Checking',
    official_name: null,
    mask: '1234',
    type: 'depository',
    subtype: 'checking',
    balances: { current: 100.0, available: 95.0, iso_currency_code: 'USD' },
  },
  {
    account_id: 'plaid-account-2',
    name: 'Savings',
    official_name: 'Main Savings',
    mask: '5678',
    type: 'depository',
    subtype: 'savings',
    balances: { current: 5000.0, available: null, iso_currency_code: 'USD' },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleBalancesRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptSecret.mockResolvedValue('access-token-plain');
    mockUpsertAccount.mockResolvedValue({});
  });

  it('returns empty counts when there are no active items', async () => {
    mockGetAllActivePlaidItems.mockResolvedValue([]);

    const ctx: BalancesRefreshContext = { step: makeStep() };
    const result = await handleBalancesRefresh(ctx);

    expect(result).toEqual({ itemsRefreshed: 0, itemsFailed: 0 });
    expect(mockAccountsGet).not.toHaveBeenCalled();
  });

  it('happy path: refreshes balances for all active items', async () => {
    mockGetAllActivePlaidItems.mockResolvedValue([FAKE_ITEM]);
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);
    mockAccountsGet.mockResolvedValue({ data: { accounts: FAKE_PLAID_ACCOUNTS } });

    const ctx: BalancesRefreshContext = { step: makeStep() };
    const result = await handleBalancesRefresh(ctx);

    expect(result).toEqual({ itemsRefreshed: 1, itemsFailed: 0 });
    expect(mockAccountsGet).toHaveBeenCalledOnce();
    expect(mockAccountsGet).toHaveBeenCalledWith({ access_token: 'access-token-plain' });
    expect(mockUpsertAccount).toHaveBeenCalledTimes(FAKE_PLAID_ACCOUNTS.length);
  });

  it('counts correctly for multiple items', async () => {
    const item2 = { ...FAKE_ITEM, id: 'item-uuid-2', plaidItemId: 'plaid-item-2' };
    mockGetAllActivePlaidItems.mockResolvedValue([FAKE_ITEM, item2]);
    mockGetPlaidItemById
      .mockResolvedValueOnce(FAKE_ITEM)
      .mockResolvedValueOnce(item2);
    mockAccountsGet.mockResolvedValue({ data: { accounts: FAKE_PLAID_ACCOUNTS } });

    const ctx: BalancesRefreshContext = { step: makeStep() };
    const result = await handleBalancesRefresh(ctx);

    expect(result).toEqual({ itemsRefreshed: 2, itemsFailed: 0 });
    expect(mockAccountsGet).toHaveBeenCalledTimes(2);
  });

  it('counts item as failed when getPlaidItemById returns undefined', async () => {
    mockGetAllActivePlaidItems.mockResolvedValue([FAKE_ITEM]);
    mockGetPlaidItemById.mockResolvedValue(undefined);

    const ctx: BalancesRefreshContext = { step: makeStep() };
    const result = await handleBalancesRefresh(ctx);

    expect(result).toEqual({ itemsRefreshed: 0, itemsFailed: 1 });
    expect(mockAccountsGet).not.toHaveBeenCalled();
  });

  it('propagates Plaid API errors so Inngest can retry the step', async () => {
    mockGetAllActivePlaidItems.mockResolvedValue([FAKE_ITEM]);
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);
    const plaidError = Object.assign(new Error('Plaid network error'), {
      response: { data: { error_code: 'RATE_LIMIT_EXCEEDED' } },
    });
    mockAccountsGet.mockRejectedValue(plaidError);

    const ctx: BalancesRefreshContext = { step: makeStep() };

    await expect(handleBalancesRefresh(ctx)).rejects.toThrow('Plaid network error');
  });

  it('stores correct balance values in cents', async () => {
    mockGetAllActivePlaidItems.mockResolvedValue([FAKE_ITEM]);
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);
    mockAccountsGet.mockResolvedValue({
      data: {
        accounts: [
          {
            account_id: 'plaid-account-1',
            name: 'Checking',
            official_name: null,
            mask: '1234',
            type: 'depository',
            subtype: 'checking',
            balances: { current: 123.45, available: 100.0, iso_currency_code: 'USD' },
          },
        ],
      },
    });

    const ctx: BalancesRefreshContext = { step: makeStep() };
    await handleBalancesRefresh(ctx);

    const upsertArg = mockUpsertAccount.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(upsertArg?.balanceCurrent).toBe(12345n);
    expect(upsertArg?.balanceAvailable).toBe(10000n);
  });
});
