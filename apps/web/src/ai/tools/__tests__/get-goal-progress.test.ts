import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/db/queries/goals', () => ({
  getActiveGoalsByUserId: vi.fn(),
}));

vi.mock('@/db/queries/goal-progress', () => ({
  getGoalProgressForPeriod: vi.fn(),
  getLatestGoalProgress: vi.fn(),
}));

vi.mock('@/db/queries/pending-changes', () => ({
  insertPendingChange: vi.fn(),
}));

import { getActiveGoalsByUserId } from '@/db/queries/goals';
import { getGoalProgressForPeriod, getLatestGoalProgress } from '@/db/queries/goal-progress';
import { handler, inputSchema } from '../get-goal-progress';

const ctx = { userId: brand<UserId>('user-1') };

// Minimal goal row shape the handler cares about
function makeGoal(id: string, name: string, kind: 'save_for' | 'reduce_category_spend' = 'save_for') {
  return {
    id,
    userId: 'user-1',
    name,
    kind,
    targetAmountCents: null,
    targetDate: null,
    priority: 0,
    constraints: {},
    status: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Minimal progress row shape
function makeProgress(goalId: string, actualCents: bigint, targetCents: bigint, onTrack: boolean, anomalies: string[] = []) {
  return {
    id: `progress-${goalId}`,
    goalId,
    period: '2026-05-01',
    actualCents,
    targetCents,
    onTrack,
    notes: { daysRemainingInPeriod: 5, anomalies },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('get-goal-progress handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no period-specific row computed yet → falls back to latest
    vi.mocked(getGoalProgressForPeriod).mockResolvedValue(undefined);
  });

  it('returns empty goals list and zeroed summary when no active goals', async () => {
    vi.mocked(getActiveGoalsByUserId).mockResolvedValueOnce([]);

    const result = await handler({}, ctx);

    expect(result.goals).toHaveLength(0);
    expect(result.summary.totalActive).toBe(0);
    expect(result.summary.onTrackCount).toBe(0);
    expect(result.summary.offTrackCount).toBe(0);
    expect(result.summary.noDataCount).toBe(0);
    expect(getLatestGoalProgress).not.toHaveBeenCalled();
  });

  it('returns goals with progress data and correct summary counts', async () => {
    const goals = [
      makeGoal('goal-1', 'Save for car', 'save_for'),
      makeGoal('goal-2', 'Reduce dining', 'reduce_category_spend'),
      makeGoal('goal-3', 'Boost savings', 'save_for'),
    ];
    vi.mocked(getActiveGoalsByUserId).mockResolvedValueOnce(goals);

    vi.mocked(getLatestGoalProgress)
      .mockResolvedValueOnce(makeProgress('goal-1', 80000n, 100000n, true))
      .mockResolvedValueOnce(makeProgress('goal-2', 120000n, 100000n, false, ['$200 over Dining budget']))
      .mockResolvedValueOnce(undefined); // no data for goal-3

    const result = await handler({}, ctx);

    expect(result.goals).toHaveLength(3);
    expect(result.summary.totalActive).toBe(3);
    expect(result.summary.onTrackCount).toBe(1);
    expect(result.summary.offTrackCount).toBe(1);
    expect(result.summary.noDataCount).toBe(1);
  });

  it('computes progressPercent correctly', async () => {
    vi.mocked(getActiveGoalsByUserId).mockResolvedValueOnce([
      makeGoal('goal-1', 'Save for car'),
    ]);
    vi.mocked(getLatestGoalProgress).mockResolvedValueOnce(
      makeProgress('goal-1', 75000n, 100000n, true),
    );

    const result = await handler({}, ctx);
    const item = result.goals[0];
    expect(item?.progressPercent).toBe(75);
  });

  it('falls back to latest progress when requested period has no data', async () => {
    const goal = makeGoal('goal-1', 'Save for car');
    vi.mocked(getActiveGoalsByUserId).mockResolvedValueOnce([goal]);
    // getGoalProgressForPeriod returns undefined (already default in beforeEach)
    const latestProgress = makeProgress('goal-1', 80000n, 100000n, true);
    vi.mocked(getLatestGoalProgress).mockResolvedValueOnce(latestProgress);

    const result = await handler({ period: '2026-03-01' }, ctx);

    expect(getGoalProgressForPeriod).toHaveBeenCalledWith(goal.id, '2026-03-01');
    expect(getLatestGoalProgress).toHaveBeenCalledWith(goal.id);
    expect(result.goals[0]?.onTrack).toBe(true);
  });

  it('returns null progressPercent when targetCents is 0', async () => {
    vi.mocked(getActiveGoalsByUserId).mockResolvedValueOnce([
      makeGoal('goal-1', 'Save for car'),
    ]);
    vi.mocked(getLatestGoalProgress).mockResolvedValueOnce(
      makeProgress('goal-1', 0n, 0n, true),
    );

    const result = await handler({}, ctx);
    expect(result.goals[0]?.progressPercent).toBeNull();
  });

  it('surfaces anomalies from progress notes', async () => {
    vi.mocked(getActiveGoalsByUserId).mockResolvedValueOnce([
      makeGoal('goal-1', 'Reduce dining', 'reduce_category_spend'),
    ]);
    const anomalyMsg = "You're $200 over your Dining budget with 5 days left";
    vi.mocked(getLatestGoalProgress).mockResolvedValueOnce(
      makeProgress('goal-1', 120000n, 100000n, false, [anomalyMsg]),
    );

    const result = await handler({}, ctx);
    expect(result.goals[0]?.anomalies).toContain(anomalyMsg);
  });

  it('accepts a valid period param and queries that period', async () => {
    const goal = makeGoal('goal-1', 'Save for car');
    vi.mocked(getActiveGoalsByUserId).mockResolvedValueOnce([goal]);
    const progressForPeriod = { ...makeProgress('goal-1', 50000n, 100000n, true), period: '2026-03-01' };
    vi.mocked(getGoalProgressForPeriod).mockResolvedValueOnce(progressForPeriod);

    const result = await handler({ period: '2026-03-01' }, ctx);

    expect(result.period).toBe('2026-03-01');
    expect(getGoalProgressForPeriod).toHaveBeenCalledWith(goal.id, '2026-03-01');
    expect(result.goals[0]?.progressPeriod).toBe('2026-03-01');
    // Found period-specific data → should NOT fall back to getLatestGoalProgress
    expect(getLatestGoalProgress).not.toHaveBeenCalled();
  });

  it('defaults period to current month when omitted', async () => {
    vi.mocked(getActiveGoalsByUserId).mockResolvedValueOnce([]);
    const result = await handler({}, ctx);
    // Should be YYYY-MM-01 format
    expect(result.period).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('rejects invalid period format via inputSchema', () => {
    const parsed = inputSchema.safeParse({ period: 'not-a-date' });
    expect(parsed.success).toBe(false);
  });

  it('rejects period without leading zeros via inputSchema', () => {
    const parsed = inputSchema.safeParse({ period: '2026-3-1' });
    expect(parsed.success).toBe(false);
  });
});
