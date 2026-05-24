import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/db/queries/transactions', () => ({
  aggregateTransactions: vi.fn(),
}));

import { aggregateTransactions } from '@/db/queries/transactions';
import { handler } from '../query-transactions';

const ctx = { userId: brand<UserId>('user-1') };

describe('query-transactions handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns grouped results with dollar totals', async () => {
    vi.mocked(aggregateTransactions).mockResolvedValueOnce([
      { key: 'Groceries', totalCents: 25000n, count: 5 },
      { key: 'Dining', totalCents: 12000n, count: 3 },
    ]);
    const result = await handler(
      { groupBy: 'category', startDate: '2025-10-01', endDate: '2025-10-31', type: 'spending', excludeTransfers: true },
      ctx,
    );
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0]).toMatchObject({ key: 'Groceries', totalDollars: 250, transactionCount: 5 });
    expect(result.grandTotalDollars).toBeCloseTo(370);
  });

  it('returns empty groups and zero total when no transactions', async () => {
    vi.mocked(aggregateTransactions).mockResolvedValueOnce([]);
    const result = await handler(
      { groupBy: 'merchant', startDate: '2025-10-01', endDate: '2025-10-31', type: 'spending', excludeTransfers: true },
      ctx,
    );
    expect(result.groups).toHaveLength(0);
    expect(result.grandTotalDollars).toBe(0);
  });
});
