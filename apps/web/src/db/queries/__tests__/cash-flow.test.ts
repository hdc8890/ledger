import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSelect, mockFrom } = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  return { mockSelect, mockFrom };
});

vi.mock('@/lib/db', () => ({
  db: { select: mockSelect },
}));
vi.mock('@/db/schema', () => ({
  transactions: {
    userId: 'user_id',
    date: 'date',
    amountCents: 'amount_cents',
    postedAt: 'posted_at',
    pending: 'pending',
    deletedAt: 'deleted_at',
    isTransfer: 'is_transfer',
    category: 'category',
  },
}));
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
  gte: vi.fn((col: string, val: string) => `${col}>=${val}`),
  lt: vi.fn((col: string, val: string) => `${col}<${val}`),
  not: vi.fn((expr: unknown) => `NOT(${String(expr)})`),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

import { getCashFlow, getCashFlowSeries } from '../cash-flow';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

const userId = brand<UserId>('user-uuid');

/** Helper — makes mockFrom simulate three sequential Promise.all sub-queries. */
function setupThreeQueryMock(
  spendingTotal: string | null,
  incomeTotal: string | null,
  categories: ReadonlyArray<{ category: string; total: string }>,
) {
  let callCount = 0;
  mockSelect.mockImplementation(() => ({ from: mockFrom }));
  mockFrom.mockImplementation(() => {
    callCount++;
    // Each sub-query ends with .where(), possibly chained further.
    switch (callCount) {
      case 1:
        // spending query: .where()
        return { where: () => Promise.resolve([{ total: spendingTotal }]) };
      case 2:
        // income query: .where()
        return { where: () => Promise.resolve([{ total: incomeTotal }]) };
      default:
        // category query: .where().groupBy().orderBy().limit()
        return {
          where: () => ({
            groupBy: () => ({
              orderBy: () => ({
                limit: () => Promise.resolve(categories),
              }),
            }),
          }),
        };
    }
  });
}

describe('getCashFlow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns spendingCents, incomeCents, and savingsCents for a month', async () => {
    setupThreeQueryMock('300000', '500000', [{ category: 'Groceries', total: '150000' }]);
    const result = await getCashFlow(userId, new Date('2025-05-15'));
    expect(result.month).toBe('2025-05');
    expect(result.spendingCents).toBe(300000n);
    expect(result.incomeCents).toBe(500000n);
    expect(result.savingsCents).toBe(200000n);
  });

  it('handles months with no transactions (null sums)', async () => {
    setupThreeQueryMock(null, null, []);
    const result = await getCashFlow(userId, new Date('2025-01-01'));
    expect(result.spendingCents).toBe(0n);
    expect(result.incomeCents).toBe(0n);
    expect(result.savingsCents).toBe(0n);
    expect(result.topCategories).toEqual([]);
  });

  it('maps top categories with bigint amounts', async () => {
    setupThreeQueryMock('200000', '400000', [
      { category: 'Dining', total: '80000' },
      { category: 'Gas', total: '50000' },
    ]);
    const result = await getCashFlow(userId, new Date('2025-04-01'));
    expect(result.topCategories).toHaveLength(2);
    expect(result.topCategories[0]).toMatchObject({ category: 'Dining', totalCents: 80000n });
  });
});

describe('getCashFlowSeries', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns one CashFlowMonth per month requested', async () => {
    let callCount = 0;
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
    mockFrom.mockImplementation(() => {
      callCount++;
      const perQuery = callCount % 3;
      if (perQuery === 1) return { where: () => Promise.resolve([{ total: '100000' }]) };
      if (perQuery === 2) return { where: () => Promise.resolve([{ total: '150000' }]) };
      return {
        where: () => ({ groupBy: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }),
      };
    });

    const result = await getCashFlowSeries(userId, 2);
    expect(result).toHaveLength(2);
  });

  it('returns correct month labels (YYYY-MM format)', async () => {
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
    mockFrom.mockImplementation(() => ({
      where: () => Promise.resolve([{ total: null }]),
    }));
    // Override so category query also works
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount % 3 !== 0) return { where: () => Promise.resolve([{ total: null }]) };
      return {
        where: () => ({ groupBy: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }),
      };
    });

    const result = await getCashFlowSeries(userId, 3);
    result.forEach((p) => {
      expect(p.month).toMatch(/^\d{4}-\d{2}$/);
    });
  });
});
