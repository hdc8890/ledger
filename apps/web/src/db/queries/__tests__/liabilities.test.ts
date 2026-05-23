import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockReturning,
  mockSelect,
  mockFrom,
  mockWhere,
  mockLimit,
  mockInsert,
  mockValues,
  mockUpdate,
  mockSet,
  mockWhereUpdate,
  mockDelete,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockLimit = vi.fn();
  const mockWhere = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  const mockValues = vi.fn();
  const mockInsert = vi.fn();
  const mockWhereUpdate = vi.fn();
  const mockSet = vi.fn();
  const mockUpdate = vi.fn();
  const mockDelete = vi.fn();
  return {
    mockReturning,
    mockSelect,
    mockFrom,
    mockWhere,
    mockLimit,
    mockInsert,
    mockValues,
    mockUpdate,
    mockSet,
    mockWhereUpdate,
    mockDelete,
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  },
}));
vi.mock('@/db/schema', () => ({
  liabilities: {
    id: 'id',
    userId: 'user_id',
    accountId: 'account_id',
    kind: 'kind',
    balanceCents: 'balance_cents',
    apr: 'apr',
  },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

import {
  getLiabilitiesByUserId,
  getLiabilityById,
  getDebtSummary,
  insertLiability,
  updateLiability,
  upsertLiabilityByAccountId,
} from '../liabilities';
import { brand } from '@/shared/types';
import type { LiabilityId, UserId } from '@/shared/types';

const userId = brand<UserId>('user-uuid');
const liabilityId = brand<LiabilityId>('liab-uuid');

const sampleLiability = {
  id: 'liab-uuid',
  userId: 'user-uuid',
  accountId: null,
  kind: 'mortgage' as const,
  name: 'Home Mortgage',
  balanceCents: 30000000n,
  apr: 0.065,
  termMonths: 360,
  originalPrincipalCents: 35000000n,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('getLiabilitiesByUserId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
  });

  it('returns liabilities for the given user', async () => {
    mockWhere.mockResolvedValueOnce([sampleLiability]);
    const result = await getLiabilitiesByUserId(userId);
    expect(result).toEqual([sampleLiability]);
  });
});

describe('getLiabilityById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
  });

  it('returns the liability when found', async () => {
    mockLimit.mockResolvedValueOnce([sampleLiability]);
    const result = await getLiabilityById(liabilityId);
    expect(result).toEqual(sampleLiability);
  });

  it('returns undefined when not found', async () => {
    mockLimit.mockResolvedValueOnce([]);
    const result = await getLiabilityById(brand<LiabilityId>('missing-uuid'));
    expect(result).toBeUndefined();
  });
});

describe('getDebtSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns totals and byKind with bigint amounts', async () => {
    let callCount = 0;
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 1) {
        // totals query — ends with .where()
        return {
          where: () =>
            Promise.resolve([
              { totalBalanceCents: '30000000', estimatedMonthlyMinimumCents: '162500' },
            ]),
        };
      }
      // byKind query — ends with .where().groupBy()
      return {
        where: () => ({
          groupBy: () =>
            Promise.resolve([{ kind: 'mortgage', totalCents: '30000000', count: 1 }]),
        }),
      };
    });

    const result = await getDebtSummary(userId);
    expect(result.totalBalanceCents).toBe(30000000n);
    expect(result.estimatedMonthlyMinimumCents).toBe(162500n);
    expect(result.byKind).toHaveLength(1);
    expect(result.byKind[0]).toMatchObject({ kind: 'mortgage', totalCents: 30000000n, count: 1 });
  });

  it('returns null estimatedMonthlyMinimumCents when all APRs are unknown', async () => {
    let callCount = 0;
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount % 2 === 1) {
        return {
          where: () =>
            Promise.resolve([{ totalBalanceCents: '10000000', estimatedMonthlyMinimumCents: null }]),
        };
      }
      return { where: () => ({ groupBy: () => Promise.resolve([]) }) };
    });

    const result = await getDebtSummary(userId);
    expect(result.estimatedMonthlyMinimumCents).toBeNull();
  });
});

describe('insertLiability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ returning: mockReturning });
  });

  it('returns the inserted row', async () => {
    mockReturning.mockResolvedValueOnce([sampleLiability]);
    const result = await insertLiability(sampleLiability);
    expect(result).toEqual(sampleLiability);
  });

  it('throws if no row returned', async () => {
    mockReturning.mockResolvedValueOnce([]);
    await expect(insertLiability(sampleLiability)).rejects.toThrow(
      'insertLiability: no row returned',
    );
  });
});

describe('updateLiability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhereUpdate });
    mockWhereUpdate.mockReturnValue({ returning: mockReturning });
  });

  it('calls set with patch + updatedAt', async () => {
    mockReturning.mockResolvedValueOnce([{ ...sampleLiability, balanceCents: 29000000n }]);
    const result = await updateLiability(liabilityId, { balanceCents: 29000000n });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ balanceCents: 29000000n, updatedAt: expect.any(Date) }),
    );
    expect(result?.balanceCents).toBe(29000000n);
  });

  it('returns undefined when not found', async () => {
    mockReturning.mockResolvedValueOnce([]);
    const result = await updateLiability(brand<LiabilityId>('missing-uuid'), { name: 'x' });
    expect(result).toBeUndefined();
  });
});

describe('upsertLiabilityByAccountId', () => {
  const plaidLiability = { ...sampleLiability, accountId: 'acct-uuid' };

  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: vi.fn().mockReturnValue({ returning: mockReturning }) });
  });

  it('throws when accountId is null (guard)', async () => {
    await expect(upsertLiabilityByAccountId({ ...sampleLiability, accountId: null })).rejects.toThrow(
      'upsertLiabilityByAccountId: accountId must be non-null',
    );
  });

  it('throws when accountId is undefined (guard)', async () => {
    await expect(
      upsertLiabilityByAccountId({ ...plaidLiability, accountId: undefined }),
    ).rejects.toThrow('upsertLiabilityByAccountId: accountId must be non-null');
  });

  it('returns the upserted row on successful insert', async () => {
    mockReturning.mockResolvedValueOnce([plaidLiability]);
    const result = await upsertLiabilityByAccountId(plaidLiability);
    expect(result).toEqual(plaidLiability);
    expect(mockValues).toHaveBeenCalledWith(plaidLiability);
  });

  it('throws if no row returned', async () => {
    mockReturning.mockResolvedValueOnce([]);
    await expect(upsertLiabilityByAccountId(plaidLiability)).rejects.toThrow(
      'upsertLiabilityByAccountId: no row returned',
    );
  });
});
