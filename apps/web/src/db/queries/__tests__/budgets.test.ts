import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Drizzle mock — set up before vi.mock factories run.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const mockReturningConflict = vi.fn();
  const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturningConflict }));
  const mockReturningInsert = vi.fn();
  const mockValues = vi.fn(() => ({
    returning: mockReturningInsert,
    onConflictDoUpdate: mockOnConflictDoUpdate,
  }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));

  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn();
  const mockGroupBy = vi.fn();
  const mockWhere = vi.fn(() => ({ orderBy: mockOrderBy, limit: mockLimit, groupBy: mockGroupBy }));
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));

  return {
    mockReturningConflict,
    mockOnConflictDoUpdate,
    mockReturningInsert,
    mockValues,
    mockInsert,
    mockLimit,
    mockOrderBy,
    mockGroupBy,
    mockWhere,
    mockFrom,
    mockSelect,
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    insert: mocks.mockInsert,
    select: mocks.mockSelect,
  },
}));

vi.mock('@/db/schema', () => ({
  budgets: {
    id: 'id',
    userId: 'user_id',
    goalId: 'goal_id',
    period: 'period',
    category: 'category',
    capCents: 'cap_cents',
    manualOverride: 'manual_override',
    createdBy: 'created_by',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  transactions: {
    userId: 'user_id',
    category: 'category',
    amountCents: 'amount_cents',
    deletedAt: 'deleted_at',
    pending: 'pending',
    isTransfer: 'is_transfer',
    postedAt: 'posted_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: unknown) => `${col}=${String(val)}`),
  and: vi.fn((...args: unknown[]) => args.join(' AND ')),
  not: vi.fn((col: string) => `NOT ${col}`),
  gte: vi.fn((col: string, val: unknown) => `${col}>=${String(val)}`),
  lt: vi.fn((col: string, val: unknown) => `${col}<${String(val)}`),
  desc: vi.fn((col: string) => `${col} DESC`),
  sql: vi.fn((parts: TemplateStringsArray) => parts[0]),
}));

import { brand } from '@/shared/types';
import type { UserId, GoalId, BudgetId } from '@/shared/types';
import {
  insertBudget,
  upsertBudget,
  getBudgetsByUserPeriod,
  getBudgetsByGoalId,
  getBudgetById,
  getBudgetsWithActuals,
} from '../budgets';

const USER_ID = brand<UserId>('a17c2f90-1234-4d56-89ab-000000000001');
const GOAL_ID = brand<GoalId>('b27c3f91-1234-4d56-89ab-000000000002');
const BUDGET_ID = brand<BudgetId>('c37d4g92-1234-4d56-89ab-000000000003');

const sampleBudget = {
  id: BUDGET_ID,
  userId: USER_ID,
  goalId: GOAL_ID,
  period: '2025-06-01',
  category: 'Dining',
  capCents: 60_000n, // $600
  manualOverride: false,
  createdBy: 'ai' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('insertBudget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the inserted budget row', async () => {
    mocks.mockReturningInsert.mockResolvedValueOnce([sampleBudget]);

    const result = await insertBudget({
      userId: USER_ID,
      goalId: GOAL_ID,
      period: '2025-06-01',
      category: 'Dining',
      capCents: 60_000n,
      manualOverride: false,
      createdBy: 'ai',
    });

    expect(result).toEqual(sampleBudget);
    expect(mocks.mockInsert).toHaveBeenCalledOnce();
    expect(mocks.mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        category: 'Dining',
        capCents: 60_000n,
      }),
    );
  });

  it('throws if no row returned', async () => {
    mocks.mockReturningInsert.mockResolvedValueOnce([]);

    await expect(
      insertBudget({
        userId: USER_ID,
        goalId: GOAL_ID,
        period: '2025-06-01',
        category: 'Dining',
        capCents: 60_000n,
        manualOverride: false,
        createdBy: 'ai',
      }),
    ).rejects.toThrow('insertBudget: no row returned');
  });

  it('throws when capCents is zero or negative', async () => {
    await expect(
      insertBudget({
        userId: USER_ID,
        goalId: GOAL_ID,
        period: '2025-06-01',
        category: 'Dining',
        capCents: 0n,
        manualOverride: false,
        createdBy: 'ai',
      }),
    ).rejects.toThrow('capCents must be positive');
  });
});

describe('upsertBudget', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the upserted budget row', async () => {
    mocks.mockReturningConflict.mockResolvedValueOnce([sampleBudget]);

    const result = await upsertBudget({
      userId: USER_ID,
      goalId: GOAL_ID,
      period: '2025-06-01',
      category: 'Dining',
      capCents: 60_000n,
      manualOverride: false,
      createdBy: 'ai',
    });

    expect(result).toEqual(sampleBudget);
    expect(mocks.mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.anything() }),
    );
  });

  it('does not overwrite a budget when manualOverride is true', async () => {
    // The DB skips the update (setWhere guard) and returns no rows.
    mocks.mockReturningConflict.mockResolvedValueOnce([]);
    // The fallback SELECT fetches the manually-set row.
    const manualBudget = { ...sampleBudget, capCents: 50_000n, manualOverride: true };
    mocks.mockLimit.mockResolvedValueOnce([manualBudget]);

    const result = await upsertBudget({
      userId: USER_ID,
      goalId: GOAL_ID,
      period: '2025-06-01',
      category: 'Dining',
      capCents: 70_000n, // AI tries to raise to $700
      manualOverride: false,
      createdBy: 'ai',
    });

    // User's manually-set $500 cap is preserved.
    expect(result.capCents).toBe(50_000n);
    expect(result.manualOverride).toBe(true);
  });

  it('throws when capCents is zero', async () => {
    await expect(
      upsertBudget({
        userId: USER_ID,
        goalId: GOAL_ID,
        period: '2025-06-01',
        category: 'Dining',
        capCents: 0n,
        manualOverride: false,
        createdBy: 'ai',
      }),
    ).rejects.toThrow('capCents must be positive');
  });
});

describe('getBudgetsByUserPeriod', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns budgets for a given user and period', async () => {
    mocks.mockOrderBy.mockResolvedValueOnce([sampleBudget]);

    const result = await getBudgetsByUserPeriod(USER_ID, '2025-06-01');

    expect(result).toEqual([sampleBudget]);
  });

  it('returns empty array when no budgets exist', async () => {
    mocks.mockOrderBy.mockResolvedValueOnce([]);

    const result = await getBudgetsByUserPeriod(USER_ID, '2025-07-01');

    expect(result).toEqual([]);
  });
});

describe('getBudgetsByGoalId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns budgets for the goal', async () => {
    mocks.mockOrderBy.mockResolvedValueOnce([sampleBudget]);

    const result = await getBudgetsByGoalId(GOAL_ID, USER_ID);

    expect(result).toEqual([sampleBudget]);
  });
});

describe('getBudgetById', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the budget when found', async () => {
    mocks.mockLimit.mockResolvedValueOnce([sampleBudget]);

    const result = await getBudgetById(BUDGET_ID);

    expect(result).toEqual(sampleBudget);
  });

  it('returns undefined when not found', async () => {
    mocks.mockLimit.mockResolvedValueOnce([]);

    const result = await getBudgetById(BUDGET_ID);

    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getBudgetsWithActuals
// ---------------------------------------------------------------------------

describe('getBudgetsWithActuals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('merges actual spending into budget rows for matching categories', async () => {
    // First select call: getBudgetsByUserPeriod → .where().orderBy()
    mocks.mockOrderBy.mockResolvedValueOnce([sampleBudget]);
    // Second select call: transaction spending → .where().groupBy()
    mocks.mockGroupBy.mockResolvedValueOnce([
      { category: 'Dining', total: '45000' },
    ]);

    const result = await getBudgetsWithActuals(USER_ID, '2025-06-01');

    expect(result).toHaveLength(1);
    expect(result[0]?.actualCents).toBe(45_000n);
    expect(result[0]?.capCents).toBe(60_000n);
    expect(result[0]?.category).toBe('Dining');
  });

  it('sets actualCents to 0n when no transactions exist for a category', async () => {
    mocks.mockOrderBy.mockResolvedValueOnce([sampleBudget]);
    // No spending rows returned for the period
    mocks.mockGroupBy.mockResolvedValueOnce([]);

    const result = await getBudgetsWithActuals(USER_ID, '2025-06-01');

    expect(result).toHaveLength(1);
    expect(result[0]?.actualCents).toBe(0n);
  });

  it('ignores spending for categories not in the budget list', async () => {
    mocks.mockOrderBy.mockResolvedValueOnce([sampleBudget]); // only 'Dining'
    mocks.mockGroupBy.mockResolvedValueOnce([
      { category: 'Groceries', total: '80000' }, // different category
    ]);

    const result = await getBudgetsWithActuals(USER_ID, '2025-06-01');

    expect(result[0]?.actualCents).toBe(0n); // Dining has no spend
  });

  it('returns empty array when no budgets exist for the period', async () => {
    mocks.mockOrderBy.mockResolvedValueOnce([]);
    mocks.mockGroupBy.mockResolvedValueOnce([]);

    const result = await getBudgetsWithActuals(USER_ID, '2025-06-01');

    expect(result).toHaveLength(0);
  });
});
