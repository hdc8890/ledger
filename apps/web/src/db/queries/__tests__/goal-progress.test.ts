import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — mock factories
// ---------------------------------------------------------------------------

const {
  mockDbInsert,
  mockDbSelect,
} = vi.hoisted(() => ({
  mockDbInsert: vi.fn(),
  mockDbSelect: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    insert: mockDbInsert,
    select: mockDbSelect,
  },
}));

vi.mock('@/db/schema', () => ({
  goalProgress: {
    $inferSelect: {},
    $inferInsert: {},
    goalId: 'goal_id',
    period: 'period',
  },
}));

import type { GoalId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GOAL_ID = 'goal-uuid-1' as GoalId;
const PERIOD = '2025-06-01';

const FAKE_ROW = {
  id: 'progress-1',
  goalId: GOAL_ID,
  period: PERIOD,
  actualCents: 100_000n,
  targetCents: 120_000n,
  onTrack: false,
  notes: { daysRemainingInPeriod: 10, anomalies: [] },
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// upsertGoalProgress
// ---------------------------------------------------------------------------

describe('upsertGoalProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path — returns inserted row', async () => {
    const onConflictDoUpdate = vi.fn().mockReturnThis();
    const returning = vi.fn().mockResolvedValue([FAKE_ROW]);

    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate,
        // chained from onConflictDoUpdate
      }),
    });
    onConflictDoUpdate.mockReturnValue({ returning });

    const { upsertGoalProgress } = await import('../goal-progress');
    const result = await upsertGoalProgress({
      goalId: GOAL_ID,
      period: PERIOD,
      actualCents: 100_000n,
      targetCents: 120_000n,
      onTrack: false,
      notes: { daysRemainingInPeriod: 10, anomalies: [] },
    });

    expect(result).toEqual(FAKE_ROW);
    expect(mockDbInsert).toHaveBeenCalledOnce();
  });

  it('throws when no row is returned', async () => {
    const onConflictDoUpdate = vi.fn().mockReturnThis();
    const returning = vi.fn().mockResolvedValue([]);

    mockDbInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({ onConflictDoUpdate }),
    });
    onConflictDoUpdate.mockReturnValue({ returning });

    const { upsertGoalProgress } = await import('../goal-progress');

    await expect(
      upsertGoalProgress({
        goalId: GOAL_ID,
        period: PERIOD,
        actualCents: 0n,
        targetCents: 0n,
        onTrack: true,
        notes: null,
      }),
    ).rejects.toThrow('upsertGoalProgress: no row returned');
  });
});

// ---------------------------------------------------------------------------
// getGoalProgressByGoalId
// ---------------------------------------------------------------------------

describe('getGoalProgressByGoalId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns rows ordered by period desc', async () => {
    const rows = [FAKE_ROW, { ...FAKE_ROW, period: '2025-05-01', id: 'progress-2' }];
    const orderBy = vi.fn().mockResolvedValue(rows);
    const where = vi.fn().mockReturnValue({ orderBy });
    const from = vi.fn().mockReturnValue({ where });
    mockDbSelect.mockReturnValue({ from });

    const { getGoalProgressByGoalId } = await import('../goal-progress');
    const result = await getGoalProgressByGoalId(GOAL_ID);

    expect(result).toEqual(rows);
    expect(mockDbSelect).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// getGoalProgressForPeriod
// ---------------------------------------------------------------------------

describe('getGoalProgressForPeriod', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the row when found', async () => {
    const limit = vi.fn().mockResolvedValue([FAKE_ROW]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    mockDbSelect.mockReturnValue({ from });

    const { getGoalProgressForPeriod } = await import('../goal-progress');
    const result = await getGoalProgressForPeriod(GOAL_ID, PERIOD);

    expect(result).toEqual(FAKE_ROW);
  });

  it('returns undefined when not found', async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    mockDbSelect.mockReturnValue({ from });

    const { getGoalProgressForPeriod } = await import('../goal-progress');
    const result = await getGoalProgressForPeriod(GOAL_ID, '2025-01-01');

    expect(result).toBeUndefined();
  });
});
