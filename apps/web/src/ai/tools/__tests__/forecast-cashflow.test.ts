import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/db/queries/cash-flow', () => ({
  forecastCashFlowFromHistory: vi.fn(),
}));

import { forecastCashFlowFromHistory } from '@/db/queries/cash-flow';
import { handler } from '../forecast-cashflow';

const ctx = { userId: brand<UserId>('user-1') };

describe('forecast-cashflow handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('converts projected cents to dollars', async () => {
    vi.mocked(forecastCashFlowFromHistory).mockResolvedValueOnce({
      projections: [
        {
          month: '2025-11',
          projectedIncomeCents: 600000n,
          projectedSpendingCents: 400000n,
          projectedSavingsCents: 200000n,
        },
      ],
      methodology: 'Based on 3 month(s) of recent history',
      confidence: 'high',
    });
    const result = await handler({ months: 1 }, ctx);
    expect(result.projections).toHaveLength(1);
    expect(result.projections[0]).toMatchObject({
      month: '2025-11',
      projectedIncomeDollars: 6000,
      projectedSpendingDollars: 4000,
      projectedSavingsDollars: 2000,
    });
    expect(result.confidence).toBe('high');
  });

  it('returns low confidence when no history', async () => {
    vi.mocked(forecastCashFlowFromHistory).mockResolvedValueOnce({
      projections: [
        {
          month: '2025-11',
          projectedIncomeCents: 0n,
          projectedSpendingCents: 0n,
          projectedSavingsCents: 0n,
        },
      ],
      methodology: 'Based on no month(s) of recent history',
      confidence: 'low',
    });
    const result = await handler({ months: 1 }, ctx);
    expect(result.confidence).toBe('low');
    expect(result.projections[0]?.projectedIncomeDollars).toBe(0);
  });
});
