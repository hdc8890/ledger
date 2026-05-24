import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/db/queries/transactions', () => ({
  queryTransactionsByFilter: vi.fn(),
}));

import { queryTransactionsByFilter } from '@/db/queries/transactions';
import { handler } from '../get-transactions';

const ctx = { userId: brand<UserId>('user-1') };

const sampleTxn = {
  id: 'txn-1',
  userId: 'user-1',
  accountId: 'acct-1',
  plaidTransactionId: 'plaid-txn-1',
  postedAt: '2025-10-15',
  authorizedAt: null,
  amountCents: 5432n,
  currency: 'USD',
  merchantRaw: 'AMAZON',
  merchantNormalized: 'Amazon',
  category: 'Shopping',
  categorySource: 'plaid' as const,
  categoryConfidence: 0.9,
  pending: false,
  source: 'plaid' as const,
  confidence: 1.0,
  isTransfer: false,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('get-transactions handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps transactions to output format', async () => {
    vi.mocked(queryTransactionsByFilter).mockResolvedValueOnce([sampleTxn]);
    const result = await handler({ limit: 50, offset: 0 }, ctx);
    expect(result.count).toBe(1);
    expect(result.transactions[0]).toMatchObject({
      id: 'txn-1',
      merchant: 'Amazon',
      category: 'Shopping',
      amountDollars: 54.32,
      postedAt: '2025-10-15',
    });
  });

  it('passes filters down to the query', async () => {
    vi.mocked(queryTransactionsByFilter).mockResolvedValueOnce([]);
    await handler({ startDate: '2025-10-01', endDate: '2025-10-31', limit: 50, offset: 0 }, ctx);
    expect(queryTransactionsByFilter).toHaveBeenCalledWith(
      ctx.userId,
      expect.objectContaining({ startDate: '2025-10-01', endDate: '2025-10-31' }),
    );
  });

  it('returns empty when no transactions match', async () => {
    vi.mocked(queryTransactionsByFilter).mockResolvedValueOnce([]);
    const result = await handler({ limit: 50, offset: 0 }, ctx);
    expect(result.count).toBe(0);
    expect(result.transactions).toHaveLength(0);
  });
});
