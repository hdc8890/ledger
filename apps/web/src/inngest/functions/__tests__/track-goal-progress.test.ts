import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — mock factories defined before vi.mock calls
// ---------------------------------------------------------------------------

const {
  mockGetAllUsers,
  mockGetActiveGoalsByUserId,
  mockGetBudgetsByGoalId,
  mockGetPeriodSavings,
  mockGetCategoryActuals,
  mockUpsertGoalProgress,
} = vi.hoisted(() => ({
  mockGetAllUsers: vi.fn(),
  mockGetActiveGoalsByUserId: vi.fn(),
  mockGetBudgetsByGoalId: vi.fn(),
  mockGetPeriodSavings: vi.fn(),
  mockGetCategoryActuals: vi.fn(),
  mockUpsertGoalProgress: vi.fn(),
}));

vi.mock('@/db/queries/users', () => ({
  getAllUsers: mockGetAllUsers,
}));

vi.mock('@/db/queries/goals', () => ({
  getActiveGoalsByUserId: mockGetActiveGoalsByUserId,
}));

vi.mock('@/db/queries/budgets', () => ({
  getBudgetsByGoalId: mockGetBudgetsByGoalId,
}));

vi.mock('@/db/queries/planning', () => ({
  getPeriodSavings: mockGetPeriodSavings,
  getCategoryActuals: mockGetCategoryActuals,
}));

vi.mock('@/db/queries/goal-progress', () => ({
  upsertGoalProgress: mockUpsertGoalProgress,
}));

import {
  currentPeriod,
  nextPeriod,
  daysRemainingInPeriod,
  computeAndUpsertGoalProgress,
  handleTrackGoalProgress,
  type GoalProgressContext,
} from '../track-goal-progress';
import type { UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep() {
  return {
    run: vi.fn().mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn()),
  };
}

const USER_ID = 'user-uuid-1' as UserId;
const FAKE_USER = {
  id: USER_ID,
  clerkId: 'clerk-1',
  settings: {},
  householdId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const FAKE_SAVINGS = {
  incomeCents: 500_000n, // $5,000
  spendingCents: 350_000n, // $3,500
  savingsCents: 150_000n, // $1,500
};

function makeGoal(overrides: Partial<{
  id: string;
  kind: 'save_for' | 'accelerate_debt' | 'reduce_category_spend' | 'increase_savings_rate';
  targetAmountCents: bigint | null;
  targetDate: string | null;
}> = {}) {
  return {
    id: overrides.id ?? 'goal-1',
    userId: USER_ID,
    kind: overrides.kind ?? 'save_for',
    name: 'Test Goal',
    // Use undefined check so null is preserved (null ?? default would swallow null)
    targetAmountCents: overrides.targetAmountCents !== undefined ? overrides.targetAmountCents : 120_000_00n,
    targetDate: overrides.targetDate !== undefined ? overrides.targetDate : null,
    priority: 0,
    constraints: {},
    status: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeBudget(category: string, capCents: bigint, period: string) {
  return {
    id: `budget-${category}`,
    userId: USER_ID,
    goalId: 'goal-1',
    period,
    category,
    capCents,
    manualOverride: false,
    createdBy: 'ai' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Period helpers
// ---------------------------------------------------------------------------

describe('currentPeriod', () => {
  it('returns first day of current UTC month in YYYY-MM-DD format', () => {
    const result = currentPeriod();
    expect(result).toMatch(/^\d{4}-\d{2}-01$/);
  });
});

describe('nextPeriod', () => {
  it('advances month by 1', () => {
    expect(nextPeriod('2025-01-01')).toBe('2025-02-01');
  });

  it('wraps year at December', () => {
    expect(nextPeriod('2025-12-01')).toBe('2026-01-01');
  });
});

describe('daysRemainingInPeriod', () => {
  it('returns a non-negative number for the current period', () => {
    const d = daysRemainingInPeriod(currentPeriod());
    expect(d).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 for a past period', () => {
    expect(daysRemainingInPeriod('2000-01-01')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeAndUpsertGoalProgress
// ---------------------------------------------------------------------------

describe('computeAndUpsertGoalProgress', () => {
  const PERIOD = '2025-06-01';

  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertGoalProgress.mockResolvedValue({});
    mockGetBudgetsByGoalId.mockResolvedValue([]);
    mockGetPeriodSavings.mockResolvedValue(FAKE_SAVINGS);
    mockGetCategoryActuals.mockResolvedValue(new Map<string, bigint>());
  });

  it('returns zeros when user has no active goals', async () => {
    mockGetActiveGoalsByUserId.mockResolvedValue([]);

    const result = await computeAndUpsertGoalProgress(USER_ID, PERIOD);

    expect(result).toEqual({ goalsTracked: 0, anomalyCount: 0 });
    expect(mockUpsertGoalProgress).not.toHaveBeenCalled();
  });

  // --- save_for ---

  it('save_for with no target amount — on_track=true, targetCents=0', async () => {
    const goal = makeGoal({ kind: 'save_for', targetAmountCents: null });
    mockGetActiveGoalsByUserId.mockResolvedValue([goal]);

    const result = await computeAndUpsertGoalProgress(USER_ID, PERIOD);

    expect(result.goalsTracked).toBe(1);
    expect(result.anomalyCount).toBe(0);
    const call = mockUpsertGoalProgress.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.targetCents).toBe(0n);
    expect(call?.onTrack).toBe(true);
  });

  it('save_for with target and no date — uses 12-month horizon', async () => {
    const goal = makeGoal({ kind: 'save_for', targetAmountCents: 12_000_00n, targetDate: null });
    mockGetActiveGoalsByUserId.mockResolvedValue([goal]);
    // Monthly target = 12000_00 / 12 = 1000_00 = $1,000
    // Actual savings = $1,500 → on track
    mockGetPeriodSavings.mockResolvedValue({ incomeCents: 500_000n, spendingCents: 350_000n, savingsCents: 150_000n });

    const result = await computeAndUpsertGoalProgress(USER_ID, PERIOD);

    expect(result.goalsTracked).toBe(1);
    const call = mockUpsertGoalProgress.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.targetCents).toBe(100_000n); // $12k / 12 months = $1,000 = 100000 cents
    expect(call?.actualCents).toBe(150_000n);
    expect(call?.onTrack).toBe(true);
    expect(result.anomalyCount).toBe(0);
  });

  it('save_for behind target — anomaly generated', async () => {
    const goal = makeGoal({ kind: 'save_for', targetAmountCents: 12_000_00n, targetDate: null });
    mockGetActiveGoalsByUserId.mockResolvedValue([goal]);
    // Actual savings = $500 < $1,000 target → not on track
    mockGetPeriodSavings.mockResolvedValue({ incomeCents: 200_000n, spendingCents: 150_000n, savingsCents: 50_000n });

    const result = await computeAndUpsertGoalProgress(USER_ID, PERIOD);

    const call = mockUpsertGoalProgress.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.onTrack).toBe(false);
    expect(result.anomalyCount).toBe(1);
    const notes = call?.notes as { anomalies: string[] };
    expect(notes.anomalies[0]).toMatch(/below your monthly target/);
  });

  // --- increase_savings_rate ---

  it('increase_savings_rate — on_track when savings >= 20% of income', async () => {
    const goal = makeGoal({ kind: 'increase_savings_rate', targetAmountCents: null });
    mockGetActiveGoalsByUserId.mockResolvedValue([goal]);
    // income = $5,000 → 20% target = $1,000. savings = $1,500 → on track
    mockGetPeriodSavings.mockResolvedValue({ incomeCents: 500_000n, spendingCents: 350_000n, savingsCents: 150_000n });

    await computeAndUpsertGoalProgress(USER_ID, PERIOD);

    const call = mockUpsertGoalProgress.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.targetCents).toBe(100_000n); // 20% of 500_000
    expect(call?.actualCents).toBe(150_000n);
    expect(call?.onTrack).toBe(true);
  });

  it('increase_savings_rate — anomaly when below 20%', async () => {
    const goal = makeGoal({ kind: 'increase_savings_rate', targetAmountCents: null });
    mockGetActiveGoalsByUserId.mockResolvedValue([goal]);
    // income = $5,000 → 20% target = $1,000. savings = $500 → not on track
    mockGetPeriodSavings.mockResolvedValue({ incomeCents: 500_000n, spendingCents: 450_000n, savingsCents: 50_000n });

    const result = await computeAndUpsertGoalProgress(USER_ID, PERIOD);

    const call = mockUpsertGoalProgress.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.onTrack).toBe(false);
    expect(result.anomalyCount).toBe(1);
    const notes = call?.notes as { anomalies: string[] };
    expect(notes.anomalies[0]).toMatch(/20% savings rate/);
  });

  // --- accelerate_debt ---

  it('accelerate_debt with no target — on_track=true when saving anything', async () => {
    const goal = makeGoal({ kind: 'accelerate_debt', targetAmountCents: null });
    mockGetActiveGoalsByUserId.mockResolvedValue([goal]);
    mockGetPeriodSavings.mockResolvedValue({ incomeCents: 200_000n, spendingCents: 150_000n, savingsCents: 50_000n });

    await computeAndUpsertGoalProgress(USER_ID, PERIOD);

    const call = mockUpsertGoalProgress.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.targetCents).toBe(0n);
    expect(call?.onTrack).toBe(true);
    const notes = call?.notes as { message?: string };
    expect(notes.message).toMatch(/No extra payment target/);
  });

  it('accelerate_debt with target met — on_track=true', async () => {
    const goal = makeGoal({ kind: 'accelerate_debt', targetAmountCents: 50_000n });
    mockGetActiveGoalsByUserId.mockResolvedValue([goal]);
    mockGetPeriodSavings.mockResolvedValue({ incomeCents: 200_000n, spendingCents: 100_000n, savingsCents: 100_000n });

    await computeAndUpsertGoalProgress(USER_ID, PERIOD);

    const call = mockUpsertGoalProgress.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.onTrack).toBe(true);
  });

  // --- reduce_category_spend ---

  it('reduce_category_spend with no budgets — returns message, on_track=true', async () => {
    const goal = makeGoal({ kind: 'reduce_category_spend' });
    mockGetActiveGoalsByUserId.mockResolvedValue([goal]);
    mockGetBudgetsByGoalId.mockResolvedValue([]);

    await computeAndUpsertGoalProgress(USER_ID, PERIOD);

    const call = mockUpsertGoalProgress.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.onTrack).toBe(true);
    const notes = call?.notes as { message?: string };
    expect(notes.message).toMatch(/No budget plan approved/);
  });

  it('reduce_category_spend within budget — on_track=true, no anomaly', async () => {
    const goal = makeGoal({ kind: 'reduce_category_spend' });
    mockGetActiveGoalsByUserId.mockResolvedValue([goal]);
    // Budget: $300 Dining cap. Actual: $200 (within budget).
    const budget = makeBudget('Dining', 30_000n, PERIOD);
    mockGetBudgetsByGoalId.mockResolvedValue([budget]);
    mockGetCategoryActuals.mockResolvedValue(new Map([['Dining', 20_000n]]));

    const result = await computeAndUpsertGoalProgress(USER_ID, PERIOD);

    const call = mockUpsertGoalProgress.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.actualCents).toBe(20_000n);
    expect(call?.targetCents).toBe(30_000n);
    expect(call?.onTrack).toBe(true);
    expect(result.anomalyCount).toBe(0);
  });

  it('reduce_category_spend over budget — on_track=false, anomaly surfaced', async () => {
    const goal = makeGoal({ kind: 'reduce_category_spend' });
    mockGetActiveGoalsByUserId.mockResolvedValue([goal]);
    // Budget: $300 Dining cap. Actual: $500 ($200 over).
    const budget = makeBudget('Dining', 30_000n, PERIOD);
    mockGetBudgetsByGoalId.mockResolvedValue([budget]);
    mockGetCategoryActuals.mockResolvedValue(new Map([['Dining', 50_000n]]));

    const result = await computeAndUpsertGoalProgress(USER_ID, PERIOD);

    const call = mockUpsertGoalProgress.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.onTrack).toBe(false);
    expect(result.anomalyCount).toBe(1);
    const notes = call?.notes as { anomalies: string[] };
    expect(notes.anomalies[0]).toMatch(/\$200 over your Dining budget/);
  });

  it('reduce_category_spend only includes budgets for the current period', async () => {
    const goal = makeGoal({ kind: 'reduce_category_spend' });
    mockGetActiveGoalsByUserId.mockResolvedValue([goal]);
    // Return budgets from BOTH current and a past period
    const currentBudget = makeBudget('Dining', 30_000n, PERIOD);
    const pastBudget = makeBudget('Shopping', 20_000n, '2025-05-01');
    mockGetBudgetsByGoalId.mockResolvedValue([currentBudget, pastBudget]);
    mockGetCategoryActuals.mockResolvedValue(new Map([['Dining', 10_000n]]));

    const result = await computeAndUpsertGoalProgress(USER_ID, PERIOD);

    // Only current-period budget ($300 Dining) should count
    const call = mockUpsertGoalProgress.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.targetCents).toBe(30_000n); // only Dining budget
    expect(call?.actualCents).toBe(10_000n);
    expect(result.anomalyCount).toBe(0);
  });

  // --- Idempotency ---

  it('upserts once per goal (idempotent re-run)', async () => {
    const goal = makeGoal({ kind: 'save_for', targetAmountCents: null });
    mockGetActiveGoalsByUserId.mockResolvedValue([goal]);

    await computeAndUpsertGoalProgress(USER_ID, PERIOD);
    await computeAndUpsertGoalProgress(USER_ID, PERIOD);

    // upsertGoalProgress called twice (once per run) — idempotency is in the DB upsert
    expect(mockUpsertGoalProgress).toHaveBeenCalledTimes(2);
    const call1 = mockUpsertGoalProgress.mock.calls[0]?.[0] as Record<string, unknown>;
    const call2 = mockUpsertGoalProgress.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(call1?.goalId).toBe(call2?.goalId);
    expect(call1?.period).toBe(call2?.period);
  });
});

// ---------------------------------------------------------------------------
// handleTrackGoalProgress
// ---------------------------------------------------------------------------

describe('handleTrackGoalProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertGoalProgress.mockResolvedValue({});
    mockGetBudgetsByGoalId.mockResolvedValue([]);
    mockGetPeriodSavings.mockResolvedValue(FAKE_SAVINGS);
    mockGetCategoryActuals.mockResolvedValue(new Map<string, bigint>());
  });

  it('returns zero counts when no users exist', async () => {
    mockGetAllUsers.mockResolvedValue([]);

    const ctx: GoalProgressContext = { step: makeStep() };
    const result = await handleTrackGoalProgress(ctx);

    expect(result).toEqual({
      usersProcessed: 0,
      usersFailed: 0,
      goalsTracked: 0,
      anomalyCount: 0,
    });
  });

  it('counts user with no active goals as processed', async () => {
    mockGetAllUsers.mockResolvedValue([FAKE_USER]);
    mockGetActiveGoalsByUserId.mockResolvedValue([]);

    const ctx: GoalProgressContext = { step: makeStep() };
    const result = await handleTrackGoalProgress(ctx);

    expect(result.usersProcessed).toBe(1);
    expect(result.usersFailed).toBe(0);
    expect(result.goalsTracked).toBe(0);
    expect(result.anomalyCount).toBe(0);
    expect(mockUpsertGoalProgress).not.toHaveBeenCalled();
  });

  it('increments usersFailed when computation throws', async () => {
    mockGetAllUsers.mockResolvedValue([FAKE_USER]);
    mockGetActiveGoalsByUserId.mockRejectedValue(new Error('DB error'));

    const ctx: GoalProgressContext = { step: makeStep() };
    const result = await handleTrackGoalProgress(ctx);

    expect(result.usersProcessed).toBe(0);
    expect(result.usersFailed).toBe(1);
  });

  it('processes each user as a separate step with unique step IDs', async () => {
    const user2 = { ...FAKE_USER, id: 'user-uuid-2' as UserId, clerkId: 'clerk-2' };
    mockGetAllUsers.mockResolvedValue([FAKE_USER, user2]);
    mockGetActiveGoalsByUserId.mockResolvedValue([]);

    const step = makeStep();
    const ctx: GoalProgressContext = { step };
    await handleTrackGoalProgress(ctx);

    // step.run called once for user-id list + once per user = 3 total
    expect(step.run).toHaveBeenCalledTimes(3);
    const callIds = step.run.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(callIds[1]).toContain(USER_ID);
    expect(callIds[2]).toContain('user-uuid-2');
  });

  it('aggregates goalsTracked and anomalyCount across users', async () => {
    const user2 = { ...FAKE_USER, id: 'user-uuid-2' as UserId, clerkId: 'clerk-2' };
    mockGetAllUsers.mockResolvedValue([FAKE_USER, user2]);

    const goal = makeGoal({ kind: 'save_for', targetAmountCents: null });
    mockGetActiveGoalsByUserId.mockResolvedValue([goal]);

    const ctx: GoalProgressContext = { step: makeStep() };
    const result = await handleTrackGoalProgress(ctx);

    expect(result.usersProcessed).toBe(2);
    expect(result.usersFailed).toBe(0);
    expect(result.goalsTracked).toBe(2); // 1 goal per user
  });

  it('handles partial failure — some users ok, some failed', async () => {
    const user2 = { ...FAKE_USER, id: 'user-uuid-2' as UserId, clerkId: 'clerk-2' };
    mockGetAllUsers.mockResolvedValue([FAKE_USER, user2]);

    // First user: no goals (success). Second user: throws.
    mockGetActiveGoalsByUserId
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('oops'));

    const ctx: GoalProgressContext = { step: makeStep() };
    const result = await handleTrackGoalProgress(ctx);

    expect(result.usersProcessed).toBe(1);
    expect(result.usersFailed).toBe(1);
  });
});

