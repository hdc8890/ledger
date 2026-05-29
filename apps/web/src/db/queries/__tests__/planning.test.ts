import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

const { mockSelect } = vi.hoisted(() => ({ mockSelect: vi.fn() }));

vi.mock('@/lib/db', () => ({ db: { select: mockSelect } }));
vi.mock('@/db/schema', () => ({
  transactions: {
    userId: 't.user_id',
    deletedAt: 't.deleted_at',
    pending: 't.pending',
    isTransfer: 't.is_transfer',
    postedAt: 't.posted_at',
    amountCents: 't.amount_cents',
    category: 't.category',
  },
  recurringSeries: {
    userId: 'rs.user_id',
    cadence: 'rs.cadence',
    expectedAmountCents: 'rs.expected_amount_cents',
  },
}));
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
  gte: vi.fn((col: string, val: string) => `${col}>=${val}`),
  lt: vi.fn((col: string, val: string) => `${col}<${val}`),
  not: vi.fn((expr: unknown) => `NOT(${String(expr)})`),
  sql: Object.assign(
    vi.fn((...args: unknown[]) => args),
    { raw: vi.fn() },
  ),
}));

import {
  getPlannerContext,
  getMonthlyRecurringCents,
  getPeriodSavings,
  getCategoryActuals,
} from '../planning';

const userId = brand<UserId>('user-uuid');

type Series = ReadonlyArray<{ cadence: string; expectedAmountCents: bigint }>;
type Categories = ReadonlyArray<{ category: string; total: string }>;

/**
 * Install a flexible Drizzle builder. Each db.select() returns a thenable
 * chain whose resolved value depends on the query shape:
 *   - from(recurringSeries)  → series rows
 *   - any query with groupBy → category rows
 *   - otherwise (plain where) → next entry from the totals queue
 */
function installDb(opts: {
  totals?: string[];
  categories?: Categories;
  series?: Series;
}) {
  const totalsQueue = [...(opts.totals ?? [])];
  mockSelect.mockImplementation(() => {
    let table: { cadence?: unknown } | undefined;
    let grouped = false;
    const builder = {
      from(t: { cadence?: unknown }) {
        table = t;
        return builder;
      },
      where() {
        return builder;
      },
      groupBy() {
        grouped = true;
        return builder;
      },
      orderBy() {
        return builder;
      },
      then(
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) {
        let value: unknown;
        if (table && table.cadence !== undefined) value = opts.series ?? [];
        else if (grouped) value = opts.categories ?? [];
        else value = [{ total: totalsQueue.length ? totalsQueue.shift() : '0' }];
        return Promise.resolve(value).then(resolve, reject);
      },
    };
    return builder;
  });
}

describe('getPlannerContext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('averages income/spending over the window and reports high confidence', async () => {
    installDb({
      totals: ['300000', '500000'],
      categories: [{ category: 'Dining', total: '120000' }],
      series: [{ cadence: 'monthly', expectedAmountCents: 5000n }],
    });

    const ctx = await getPlannerContext(userId, 3);

    expect(ctx.avgSpendingCents).toBe(100000n);
    expect(ctx.avgIncomeCents).toBe(166666n);
    expect(ctx.currentMonthlySavingsCents).toBe(66666n);
    expect(ctx.committedMonthlyBillsCents).toBe(5000n);
    expect(ctx.spendingByCategory).toEqual([
      { category: 'Dining', avgMonthlyCents: 40000n },
    ]);
    expect(ctx.basedOnMonths).toBe(3);
    expect(ctx.confidence).toBe('high');
    expect(ctx.windowStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ctx.windowEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('reports medium confidence for a 2-month window with data', async () => {
    installDb({ totals: ['200000', '400000'], categories: [], series: [] });
    const ctx = await getPlannerContext(userId, 2);
    expect(ctx.confidence).toBe('medium');
  });

  it('reports low confidence when there is no spend/income data', async () => {
    installDb({ totals: ['0', '0'], categories: [], series: [] });
    const ctx = await getPlannerContext(userId, 3);
    expect(ctx.confidence).toBe('low');
    expect(ctx.avgSpendingCents).toBe(0n);
  });

  it('handles a zero-month window without dividing by zero', async () => {
    installDb({
      totals: ['100000', '100000'],
      categories: [{ category: 'Gas', total: '9000' }],
      series: [],
    });
    const ctx = await getPlannerContext(userId, 0);
    expect(ctx.avgSpendingCents).toBe(0n);
    expect(ctx.avgIncomeCents).toBe(0n);
    expect(ctx.spendingByCategory[0]?.avgMonthlyCents).toBe(0n);
    expect(ctx.confidence).toBe('low');
  });
});

describe('getMonthlyRecurringCents', () => {
  beforeEach(() => vi.clearAllMocks());

  it('converts every cadence to a monthly equivalent and sums them', async () => {
    installDb({
      series: [
        { cadence: 'weekly', expectedAmountCents: 1200n }, // 1200*52/12 = 5200
        { cadence: 'biweekly', expectedAmountCents: 1200n }, // 1200*26/12 = 2600
        { cadence: 'monthly', expectedAmountCents: 3000n }, // 3000
        { cadence: 'quarterly', expectedAmountCents: 3000n }, // 1000
        { cadence: 'annual', expectedAmountCents: 1200n }, // 100
      ],
    });
    const total = await getMonthlyRecurringCents(userId);
    expect(total).toBe(5200n + 2600n + 3000n + 1000n + 100n);
  });

  it('throws on an unknown cadence (exhaustiveness guard)', async () => {
    installDb({ series: [{ cadence: 'fortnightly', expectedAmountCents: 100n }] });
    await expect(getMonthlyRecurringCents(userId)).rejects.toThrow('Unknown cadence');
  });

  it('returns zero when there are no recurring series', async () => {
    installDb({ series: [] });
    expect(await getMonthlyRecurringCents(userId)).toBe(0n);
  });
});

describe('getPeriodSavings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('computes income, spending, and savings for a month', async () => {
    installDb({ totals: ['250000', '400000'] });
    const result = await getPeriodSavings(userId, '2025-03-01');
    expect(result.spendingCents).toBe(250000n);
    expect(result.incomeCents).toBe(400000n);
    expect(result.savingsCents).toBe(150000n);
  });

  it('defaults null sums to zero', async () => {
    installDb({ totals: [] });
    const result = await getPeriodSavings(userId, '2025-01-01');
    expect(result.spendingCents).toBe(0n);
    expect(result.incomeCents).toBe(0n);
    expect(result.savingsCents).toBe(0n);
  });
});

describe('getCategoryActuals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a Map of category to actual cents', async () => {
    installDb({
      categories: [
        { category: 'Dining', total: '8000' },
        { category: 'Gas', total: '5000' },
      ],
    });
    const map = await getCategoryActuals(userId, '2025-05-01');
    expect(map.get('Dining')).toBe(8000n);
    expect(map.get('Gas')).toBe(5000n);
    expect(map.size).toBe(2);
  });
});
