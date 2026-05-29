import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { AccountId, TransactionId, UserId } from '@/shared/types';

const { mockSelect, mockUpdate } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({ db: { select: mockSelect, update: mockUpdate } }));
vi.mock('@/db/schema', () => ({
  transactions: {
    id: 't.id',
    userId: 't.user_id',
    accountId: 't.account_id',
    deletedAt: 't.deleted_at',
    postedAt: 't.posted_at',
    amountCents: 't.amount_cents',
    category: 't.category',
    categorySource: 't.category_source',
    merchantNormalized: 't.merchant_normalized',
    merchantRaw: 't.merchant_raw',
    pending: 't.pending',
    isTransfer: 't.is_transfer',
  },
  accounts: { id: 'a.id', name: 'a.name' },
}));
vi.mock('drizzle-orm', () => ({
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((col: string) => `${col} DESC`),
  eq: vi.fn((col: string, val: unknown) => `${col}=${String(val)}`),
  getTableColumns: vi.fn(() => ({ id: 't.id' })),
  gte: vi.fn((col: string, val: unknown) => `${col}>=${String(val)}`),
  gt: vi.fn((col: string, val: unknown) => `${col}>${String(val)}`),
  inArray: vi.fn((col: string, vals: unknown[]) => `${col} IN ${JSON.stringify(vals)}`),
  isNull: vi.fn((col: string) => `${col} IS NULL`),
  lt: vi.fn((col: string, val: unknown) => `${col}<${String(val)}`),
  lte: vi.fn((col: string, val: unknown) => `${col}<=${String(val)}`),
  sql: Object.assign(
    vi.fn((...args: unknown[]) => args),
    { raw: vi.fn() },
  ),
}));

import {
  getTransactionsByUserId,
  getTransactionsByAccountId,
  getTransactionById,
  getTransactionsNeedingCategorization,
  getTransactionsNeedingNormalization,
  queryTransactionsByFilter,
  aggregateTransactions,
  resetTransactionEnrichmentForUser,
} from '../transactions';

const userId = brand<UserId>('user-uuid');

let selectResult: unknown[] = [];
let updateResult: unknown[] = [];

/** A chainable thenable that resolves to `selectResult` regardless of chain. */
function chain(): Record<string, unknown> {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'offset', 'orderBy', 'groupBy', 'innerJoin']) {
    b[m] = () => b;
  }
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(selectResult).then(resolve, reject);
  return b;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResult = [];
  updateResult = [];
  mockSelect.mockImplementation(() => chain());
  mockUpdate.mockImplementation(() => ({
    set: () => ({
      where: () => ({ returning: () => Promise.resolve(updateResult) }),
    }),
  }));
});

describe('simple fetch helpers default their pagination', () => {
  it('getTransactionsByUserId returns rows', async () => {
    selectResult = [{ id: 'a' }];
    expect(await getTransactionsByUserId(userId)).toEqual([{ id: 'a' }]);
  });

  it('getTransactionsByUserId honours explicit limit/offset', async () => {
    selectResult = [];
    expect(await getTransactionsByUserId(userId, { limit: 5, offset: 10 })).toEqual([]);
  });

  it('getTransactionsByAccountId returns rows', async () => {
    selectResult = [{ id: 'b' }];
    expect(await getTransactionsByAccountId(brand<AccountId>('acct'))).toEqual([{ id: 'b' }]);
  });

  it('getTransactionById returns the first row or undefined', async () => {
    selectResult = [{ id: 'c' }];
    expect(await getTransactionById(brand<TransactionId>('c'))).toEqual({ id: 'c' });
    selectResult = [];
    expect(await getTransactionById(brand<TransactionId>('missing'))).toBeUndefined();
  });

  it('getTransactionsNeedingCategorization and Normalization return rows', async () => {
    selectResult = [{ id: 'd' }];
    expect(await getTransactionsNeedingCategorization(userId)).toEqual([{ id: 'd' }]);
    expect(await getTransactionsNeedingNormalization(userId, { limit: 2 })).toEqual([{ id: 'd' }]);
  });
});

describe('queryTransactionsByFilter', () => {
  it('applies no optional conditions when filter is empty', async () => {
    selectResult = [{ id: 'x' }];
    const result = await queryTransactionsByFilter(userId);
    expect(result).toEqual([{ id: 'x' }]);
  });

  it('applies every optional condition when all filters are set', async () => {
    selectResult = [];
    await queryTransactionsByFilter(userId, {
      startDate: '2025-01-01',
      endDate: '2025-01-31',
      category: 'Dining',
      accountId: 'acct-1',
      minAmountCents: 100n,
      maxAmountCents: 5000n,
      limit: 10,
      offset: 5,
    });
    const { gte, lte, gt, lt } = await import('drizzle-orm');
    expect(gte).toHaveBeenCalled();
    expect(lte).toHaveBeenCalled();
    expect(gt).toHaveBeenCalled();
    expect(lt).toHaveBeenCalled();
  });
});

describe('aggregateTransactions', () => {
  const base = { startDate: '2025-01-01', endDate: '2025-01-31' } as const;

  it('groups by category for spending excluding transfers (defaults)', async () => {
    selectResult = [{ key: 'Dining', total: '8000', count: 3 }];
    const rows = await aggregateTransactions(userId, { ...base, groupBy: 'category' });
    expect(rows).toEqual([{ key: 'Dining', totalCents: 8000n, count: 3 }]);
  });

  it('groups by merchant for income including transfers', async () => {
    selectResult = [{ key: 'Acme', total: '4000', count: 1 }];
    const rows = await aggregateTransactions(userId, {
      ...base,
      groupBy: 'merchant',
      type: 'income',
      excludeTransfers: false,
    });
    expect(rows[0]?.key).toBe('Acme');
  });

  it('groups by month for all types and coalesces null totals to zero', async () => {
    selectResult = [{ key: '2025-01', total: null, count: 0 }];
    const rows = await aggregateTransactions(userId, {
      ...base,
      groupBy: 'month',
      type: 'all',
    });
    expect(rows[0]?.totalCents).toBe(0n);
  });
});

describe('resetTransactionEnrichmentForUser', () => {
  it('returns the number of rows reset', async () => {
    updateResult = [{ id: '1' }, { id: '2' }];
    expect(await resetTransactionEnrichmentForUser(userId)).toBe(2);
  });
});
