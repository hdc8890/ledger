import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/db/queries/cash-flow', () => ({
  summarizePeriod: vi.fn(),
}));

import { summarizePeriod } from '@/db/queries/cash-flow';
import { handler } from '../summarize-period';

const ctx = { userId: brand<UserId>('user-1') };

describe('summarize-period handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('converts cent values to dollars', async () => {
    vi.mocked(summarizePeriod).mockResolvedValueOnce({
      period: { start: '2025-10-01', end: '2025-10-31' },
      incomeCents: 500000n,
      spendingCents: 300000n,
      savingsCents: 200000n,
      topSpendingCategories: [{ category: 'Groceries', totalCents: 120000n, count: 8 }],
      topMerchants: [{ merchant: 'Costco', totalCents: 80000n, count: 3 }],
    });
    const result = await handler({ startDate: '2025-10-01', endDate: '2025-10-31' }, ctx);
    expect(result.incomeDollars).toBe(5000);
    expect(result.spendingDollars).toBe(3000);
    expect(result.savingsDollars).toBe(2000);
    expect(result.topSpendingCategories[0]).toMatchObject({
      category: 'Groceries',
      totalDollars: 1200,
      transactionCount: 8,
    });
    expect(result.topMerchants[0]).toMatchObject({ merchant: 'Costco', totalDollars: 800 });
  });

  it('passes date range to the query function', async () => {
    vi.mocked(summarizePeriod).mockResolvedValueOnce({
      period: { start: '2025-01-01', end: '2025-03-31' },
      incomeCents: 0n,
      spendingCents: 0n,
      savingsCents: 0n,
      topSpendingCategories: [],
      topMerchants: [],
    });
    await handler({ startDate: '2025-01-01', endDate: '2025-03-31' }, ctx);
    expect(summarizePeriod).toHaveBeenCalledWith(ctx.userId, '2025-01-01', '2025-03-31');
  });
});
