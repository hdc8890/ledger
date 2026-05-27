import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/db/queries/pending-changes', () => ({
  insertPendingChange: vi.fn(),
}));

vi.mock('@/db/queries/goals', () => ({
  getGoalById: vi.fn(),
}));

vi.mock('@/db/queries/planning', () => ({
  getPlannerContext: vi.fn(),
}));

import { insertPendingChange } from '@/db/queries/pending-changes';
import { getGoalById } from '@/db/queries/goals';
import { getPlannerContext } from '@/db/queries/planning';
import { handler, inputSchema } from '../propose-plan';

const userId = brand<UserId>('user-1');
const ctx = { userId };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleGoalSaveFor = {
  id: 'goal-abc',
  userId: 'user-1',
  kind: 'save_for' as const,
  name: 'Save for new car',
  targetAmountCents: 3_000_000n, // $30,000
  targetDate: '2027-06-01', // ~12 months away
  priority: 5,
  constraints: {},
  status: 'active' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sampleGoalSavingsRate = {
  ...sampleGoalSaveFor,
  id: 'goal-def',
  kind: 'increase_savings_rate' as const,
  name: 'Boost savings rate',
  targetAmountCents: null,
  targetDate: null,
  constraints: {},
};

const sampleGoalReduceSpend = {
  ...sampleGoalSaveFor,
  id: 'goal-ghi',
  kind: 'reduce_category_spend' as const,
  name: 'Cut dining spend',
  targetAmountCents: 30_000n, // $300/month reduction target
  targetDate: null,
  constraints: {},
};

const basePlannerCtx = {
  avgIncomeCents: 600_000n, // $6,000/month
  avgSpendingCents: 480_000n, // $4,800/month
  currentMonthlySavingsCents: 120_000n, // $1,200/month
  spendingByCategory: [
    { category: 'Dining', avgMonthlyCents: 80_000n }, // $800
    { category: 'Shopping', avgMonthlyCents: 120_000n }, // $1,200
    { category: 'Groceries', avgMonthlyCents: 60_000n }, // $600
    { category: 'Entertainment', avgMonthlyCents: 40_000n }, // $400
  ],
  committedMonthlyBillsCents: 150_000n, // $1,500 in recurring bills
  basedOnMonths: 3,
  confidence: 'high' as const,
  windowStart: '2025-02-01',
  windowEnd: '2025-05-01',
};

const sampleProposal = {
  id: 'proposal-1',
  userId: 'user-1',
  kind: 'plan_propose',
  payload: {},
  status: 'pending' as const,
  appliedAt: null,
  createdAt: new Date(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('propose-plan handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a pending_changes proposal for a save_for goal', async () => {
    vi.mocked(getGoalById).mockResolvedValueOnce(sampleGoalSaveFor);
    vi.mocked(getPlannerContext).mockResolvedValueOnce(basePlannerCtx);
    vi.mocked(insertPendingChange).mockResolvedValueOnce(sampleProposal);

    const result = await handler(
      { goalId: 'goal-abc', planMonths: 6 },
      ctx,
    );

    expect(insertPendingChange).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        kind: 'plan_propose',
        status: 'pending',
        payload: expect.objectContaining({
          goalId: 'goal-abc',
          planMonths: 6,
          categoryDeltas: expect.arrayContaining([
            expect.objectContaining({ category: expect.any(String) }),
          ]),
        }),
      }),
    );

    expect(result.proposalId).toBe('proposal-1');
    expect(result.plan.goalName).toBe('Save for new car');
    expect(result.plan.goalKind).toBe('save_for');
    expect(result.plan.categoryDeltas.length).toBeGreaterThan(0);
    expect(result.plan.confidence).toBe('high');
    expect(result.plan.assumptions.length).toBeGreaterThan(0);
  });

  it('produces category reductions proportional to spend share', async () => {
    vi.mocked(getGoalById).mockResolvedValueOnce(sampleGoalSaveFor);
    vi.mocked(getPlannerContext).mockResolvedValueOnce(basePlannerCtx);
    vi.mocked(insertPendingChange).mockResolvedValueOnce(sampleProposal);

    const result = await handler({ goalId: 'goal-abc', planMonths: 6 }, ctx);

    // Shopping ($1200) should get a larger reduction than Dining ($800)
    const shopping = result.plan.categoryDeltas.find((d) => d.category === 'Shopping');
    const dining = result.plan.categoryDeltas.find((d) => d.category === 'Dining');
    if (shopping && dining) {
      expect(shopping.reductionDollars).toBeGreaterThan(dining.reductionDollars);
    }
  });

  it('respects exclude_categories constraint', async () => {
    const goalWithConstraint = {
      ...sampleGoalSaveFor,
      constraints: { exclude_categories: ['Shopping'] },
    };
    vi.mocked(getGoalById).mockResolvedValueOnce(goalWithConstraint);
    vi.mocked(getPlannerContext).mockResolvedValueOnce(basePlannerCtx);
    vi.mocked(insertPendingChange).mockResolvedValueOnce(sampleProposal);

    const result = await handler({ goalId: 'goal-abc', planMonths: 6 }, ctx);

    const shoppingDelta = result.plan.categoryDeltas.find((d) => d.category === 'Shopping');
    expect(shoppingDelta).toBeUndefined();
    expect(result.plan.assumptions.join(' ')).toContain('Shopping');
  });

  it('respects max_monthly_reduction_cents constraint', async () => {
    const goalWithCap = {
      ...sampleGoalSaveFor,
      constraints: { max_monthly_reduction_cents: '10000' }, // $100 max per category
    };
    vi.mocked(getGoalById).mockResolvedValueOnce(goalWithCap);
    vi.mocked(getPlannerContext).mockResolvedValueOnce(basePlannerCtx);
    vi.mocked(insertPendingChange).mockResolvedValueOnce(sampleProposal);

    const result = await handler({ goalId: 'goal-abc', planMonths: 6 }, ctx);

    for (const delta of result.plan.categoryDeltas) {
      expect(delta.reductionDollars).toBeLessThanOrEqual(100);
    }
  });

  it('creates a proposal for increase_savings_rate goal', async () => {
    vi.mocked(getGoalById).mockResolvedValueOnce(sampleGoalSavingsRate);
    vi.mocked(getPlannerContext).mockResolvedValueOnce(basePlannerCtx);
    vi.mocked(insertPendingChange).mockResolvedValueOnce({
      ...sampleProposal,
      id: 'proposal-2',
    });

    const result = await handler({ goalId: 'goal-def', planMonths: 3 }, ctx);

    // 20% of $6,000 = $1,200; currently saving $1,200 → extra needed = 0
    expect(result.plan.neededExtraMonthlySavingsDollars).toBe(0);
    expect(result.plan.assumptions.join(' ')).toContain('20%');
  });

  it('creates a proposal for reduce_category_spend goal', async () => {
    vi.mocked(getGoalById).mockResolvedValueOnce(sampleGoalReduceSpend);
    vi.mocked(getPlannerContext).mockResolvedValueOnce(basePlannerCtx);
    vi.mocked(insertPendingChange).mockResolvedValueOnce({
      ...sampleProposal,
      id: 'proposal-3',
    });

    const result = await handler({ goalId: 'goal-ghi', planMonths: 6 }, ctx);

    expect(result.plan.neededExtraMonthlySavingsDollars).toBe(300);
    expect(result.plan.categoryDeltas.length).toBeGreaterThan(0);
  });

  it('throws when goal is not found', async () => {
    vi.mocked(getGoalById).mockResolvedValueOnce(undefined);

    await expect(handler({ goalId: 'goal-missing', planMonths: 6 }, ctx)).rejects.toThrow(
      'Goal not found',
    );
    expect(insertPendingChange).not.toHaveBeenCalled();
  });

  it('throws when goal belongs to a different user', async () => {
    vi.mocked(getGoalById).mockResolvedValueOnce({
      ...sampleGoalSaveFor,
      userId: 'user-other',
    });

    await expect(handler({ goalId: 'goal-abc', planMonths: 6 }, ctx)).rejects.toThrow(
      'Forbidden',
    );
    expect(insertPendingChange).not.toHaveBeenCalled();
  });

  it('throws when goal is not active', async () => {
    vi.mocked(getGoalById).mockResolvedValueOnce({
      ...sampleGoalSaveFor,
      status: 'archived' as const,
    });

    await expect(handler({ goalId: 'goal-abc', planMonths: 6 }, ctx)).rejects.toThrow(
      'archived',
    );
    expect(insertPendingChange).not.toHaveBeenCalled();
  });

  it('returns low confidence when there is no spending history', async () => {
    vi.mocked(getGoalById).mockResolvedValueOnce(sampleGoalSaveFor);
    vi.mocked(getPlannerContext).mockResolvedValueOnce({
      ...basePlannerCtx,
      avgIncomeCents: 0n,
      avgSpendingCents: 0n,
      currentMonthlySavingsCents: 0n,
      spendingByCategory: [],
      confidence: 'low' as const,
    });
    vi.mocked(insertPendingChange).mockResolvedValueOnce(sampleProposal);

    const result = await handler({ goalId: 'goal-abc', planMonths: 6 }, ctx);

    expect(result.plan.confidence).toBe('low');
    expect(result.plan.categoryDeltas).toHaveLength(0);
  });

  describe('inputSchema validation', () => {
    it('rejects an invalid UUID for goalId', () => {
      const parsed = inputSchema.safeParse({ goalId: 'not-a-uuid', planMonths: 6 });
      expect(parsed.success).toBe(false);
    });

    it('rejects planMonths < 1', () => {
      const parsed = inputSchema.safeParse({ goalId: crypto.randomUUID(), planMonths: 0 });
      expect(parsed.success).toBe(false);
    });

    it('rejects planMonths > 24', () => {
      const parsed = inputSchema.safeParse({ goalId: crypto.randomUUID(), planMonths: 25 });
      expect(parsed.success).toBe(false);
    });

    it('accepts valid input with defaults', () => {
      const parsed = inputSchema.safeParse({ goalId: crypto.randomUUID() });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.planMonths).toBe(6);
    });
  });
});
