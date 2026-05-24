import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/db/queries/assets', () => ({
  getAssetBreakdown: vi.fn(),
}));
vi.mock('@/db/queries/liabilities', () => ({
  getDebtSummary: vi.fn(),
}));
vi.mock('@/db/queries/net-worth', () => ({
  getLatestNetWorthSnapshot: vi.fn(),
}));

import { getAssetBreakdown } from '@/db/queries/assets';
import { getDebtSummary } from '@/db/queries/liabilities';
import { getLatestNetWorthSnapshot } from '@/db/queries/net-worth';
import { handler } from '../calculate-networth';

const ctx = { userId: brand<UserId>('user-1') };

describe('calculate-networth handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes net worth from live assets and liabilities', async () => {
    vi.mocked(getAssetBreakdown).mockResolvedValueOnce([
      { kind: 'home', totalCents: 40000000n, count: 1 },
    ]);
    vi.mocked(getDebtSummary).mockResolvedValueOnce({
      totalBalanceCents: 20000000n,
      estimatedMonthlyMinimumCents: null,
      byKind: [{ kind: 'mortgage', totalCents: 20000000n, count: 1 }],
    });
    const result = await handler({}, ctx);
    expect(result.totalAssetsDollars).toBe(400000);
    expect(result.totalLiabilitiesDollars).toBe(200000);
    expect(result.netWorthDollars).toBe(200000);
    expect(result.byAssetKind[0]).toMatchObject({ kind: 'home', totalDollars: 400000 });
    expect(result.byLiabilityKind[0]).toMatchObject({ kind: 'mortgage', totalDollars: 200000 });
  });

  it('returns zero net worth when no data', async () => {
    vi.mocked(getAssetBreakdown).mockResolvedValueOnce([]);
    vi.mocked(getDebtSummary).mockResolvedValueOnce({
      totalBalanceCents: 0n,
      estimatedMonthlyMinimumCents: null,
      byKind: [],
    });
    const result = await handler({}, ctx);
    expect(result.netWorthDollars).toBe(0);
  });

  it('uses snapshot when asOf matches latest snapshot date', async () => {
    vi.mocked(getLatestNetWorthSnapshot).mockResolvedValueOnce({
      id: 'snap-1',
      userId: 'user-1',
      snapshotDate: '2025-10-01',
      assetsCents: 50000000n,
      liabilitiesCents: 10000000n,
      breakdown: { home: '50000000' },
      createdAt: new Date(),
    });
    const result = await handler({ asOf: '2025-10-01' }, ctx);
    expect(result.asOf).toBe('2025-10-01');
    expect(result.totalAssetsDollars).toBe(500000);
    expect(result.netWorthDollars).toBe(400000);
    expect(result.note).toContain('snapshot');
    // Live queries should not be called when snapshot matches
    expect(getAssetBreakdown).not.toHaveBeenCalled();
  });
});
