import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — mock factories defined before vi.mock calls
// ---------------------------------------------------------------------------

const {
  mockGetAllActivePlaidItems,
  mockGetPlaidItemById,
  mockDecryptSecret,
  mockInvestmentsHoldingsGet,
  mockUpsertAccount,
} = vi.hoisted(() => ({
  mockGetAllActivePlaidItems: vi.fn(),
  mockGetPlaidItemById: vi.fn(),
  mockDecryptSecret: vi.fn(),
  mockInvestmentsHoldingsGet: vi.fn(),
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
  plaidClient: { investmentsHoldingsGet: mockInvestmentsHoldingsGet },
}));

vi.mock('@/db/queries/accounts', () => ({
  upsertAccount: mockUpsertAccount,
}));

import {
  handleInvestmentsRefresh,
  type InvestmentsRefreshContext,
} from '../investments-refresh';

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

const FAKE_INVESTMENT_ACCOUNTS = [
  {
    account_id: 'brokerage-1',
    name: 'Brokerage',
    official_name: 'My Brokerage',
    mask: '9999',
    type: 'investment',
    subtype: 'brokerage',
    balances: { current: 50000.0, available: null, iso_currency_code: 'USD' },
  },
];

function makePlaidError(errorCode: string) {
  return Object.assign(new Error(`Plaid error: ${errorCode}`), {
    response: { data: { error_code: errorCode, error_type: 'INVALID_REQUEST' } },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleInvestmentsRefresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDecryptSecret.mockResolvedValue('access-token-plain');
    mockUpsertAccount.mockResolvedValue({});
  });

  it('returns zero counts when there are no active items', async () => {
    mockGetAllActivePlaidItems.mockResolvedValue([]);

    const ctx: InvestmentsRefreshContext = { step: makeStep() };
    const result = await handleInvestmentsRefresh(ctx);

    expect(result).toEqual({ itemsRefreshed: 0, itemsSkipped: 0 });
    expect(mockInvestmentsHoldingsGet).not.toHaveBeenCalled();
  });

  it('happy path: refreshes investment account balances', async () => {
    mockGetAllActivePlaidItems.mockResolvedValue([FAKE_ITEM]);
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);
    mockInvestmentsHoldingsGet.mockResolvedValue({
      data: { accounts: FAKE_INVESTMENT_ACCOUNTS, holdings: [], securities: [] },
    });

    const ctx: InvestmentsRefreshContext = { step: makeStep() };
    const result = await handleInvestmentsRefresh(ctx);

    expect(result).toEqual({ itemsRefreshed: 1, itemsSkipped: 0 });
    expect(mockInvestmentsHoldingsGet).toHaveBeenCalledOnce();
    expect(mockUpsertAccount).toHaveBeenCalledOnce();
  });

  it('skips item with INVALID_PRODUCT error gracefully', async () => {
    mockGetAllActivePlaidItems.mockResolvedValue([FAKE_ITEM]);
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);
    mockInvestmentsHoldingsGet.mockRejectedValue(makePlaidError('INVALID_PRODUCT'));

    const ctx: InvestmentsRefreshContext = { step: makeStep() };
    const result = await handleInvestmentsRefresh(ctx);

    expect(result).toEqual({ itemsRefreshed: 0, itemsSkipped: 1 });
  });

  it('skips item with PRODUCT_NOT_READY error gracefully', async () => {
    mockGetAllActivePlaidItems.mockResolvedValue([FAKE_ITEM]);
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);
    mockInvestmentsHoldingsGet.mockRejectedValue(makePlaidError('PRODUCT_NOT_READY'));

    const ctx: InvestmentsRefreshContext = { step: makeStep() };
    const result = await handleInvestmentsRefresh(ctx);

    expect(result).toEqual({ itemsRefreshed: 0, itemsSkipped: 1 });
  });

  it('re-throws non-product errors so the step retries', async () => {
    mockGetAllActivePlaidItems.mockResolvedValue([FAKE_ITEM]);
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);
    mockInvestmentsHoldingsGet.mockRejectedValue(new Error('Network timeout'));

    const ctx: InvestmentsRefreshContext = { step: makeStep() };

    await expect(handleInvestmentsRefresh(ctx)).rejects.toThrow('Network timeout');
  });

  it('skips item when getPlaidItemById returns undefined', async () => {
    mockGetAllActivePlaidItems.mockResolvedValue([FAKE_ITEM]);
    mockGetPlaidItemById.mockResolvedValue(undefined);

    const ctx: InvestmentsRefreshContext = { step: makeStep() };
    const result = await handleInvestmentsRefresh(ctx);

    expect(result).toEqual({ itemsRefreshed: 0, itemsSkipped: 1 });
    expect(mockInvestmentsHoldingsGet).not.toHaveBeenCalled();
  });

  it('stores balance in cents correctly', async () => {
    mockGetAllActivePlaidItems.mockResolvedValue([FAKE_ITEM]);
    mockGetPlaidItemById.mockResolvedValue(FAKE_ITEM);
    mockInvestmentsHoldingsGet.mockResolvedValue({
      data: { accounts: FAKE_INVESTMENT_ACCOUNTS, holdings: [], securities: [] },
    });

    const ctx: InvestmentsRefreshContext = { step: makeStep() };
    await handleInvestmentsRefresh(ctx);

    const upsertArg = mockUpsertAccount.mock.calls[0]?.[0] as Record<string, unknown>;
    // $50,000.00 → 5000000 cents
    expect(upsertArg?.balanceCurrent).toBe(5000000n);
    expect(upsertArg?.balanceAvailable).toBeNull();
  });
});
