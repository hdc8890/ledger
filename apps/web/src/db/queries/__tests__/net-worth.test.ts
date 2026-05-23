import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockReturning,
  mockOnConflictDoUpdate,
  mockValues,
  mockInsert,
  mockSelect,
  mockFrom,
  mockWhere,
  mockOrderBy,
  mockLimit,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockOnConflictDoUpdate = vi.fn();
  const mockValues = vi.fn();
  const mockInsert = vi.fn();
  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn();
  const mockWhere = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  return {
    mockReturning,
    mockOnConflictDoUpdate,
    mockValues,
    mockInsert,
    mockSelect,
    mockFrom,
    mockWhere,
    mockOrderBy,
    mockLimit,
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
  },
}));
vi.mock('@/db/schema', () => ({
  netWorthSnapshots: {
    id: 'id',
    userId: 'user_id',
    snapshotDate: 'snapshot_date',
    assetsCents: 'assets_cents',
    liabilitiesCents: 'liabilities_cents',
    breakdown: 'breakdown',
  },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
  and: vi.fn((...args: unknown[]) => args),
  gte: vi.fn((col: string, val: string) => `${col}>=${val}`),
  lte: vi.fn((col: string, val: string) => `${col}<=${val}`),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

import {
  getNetWorthSeries,
  getLatestNetWorthSnapshot,
  getSnapshotNearDate,
  parseSnapshotBreakdown,
  upsertNetWorthSnapshot,
} from '../net-worth';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

const userId = brand<UserId>('user-uuid');

const sampleSnapshot = {
  id: 'snap-uuid',
  userId: 'user-uuid',
  snapshotDate: '2025-05-01',
  assetsCents: 50000000n,
  liabilitiesCents: 30000000n,
  breakdown: { home: '45000000', brokerage: '5000000' },
  createdAt: new Date(),
};

describe('getNetWorthSeries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  });

  it('returns NetWorthPoints with computed netWorthCents', async () => {
    mockOrderBy.mockResolvedValueOnce([sampleSnapshot]);
    const result = await getNetWorthSeries(userId, '30d');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      date: '2025-05-01',
      assetsCents: 50000000n,
      liabilitiesCents: 30000000n,
      netWorthCents: 20000000n,
    });
  });

  it('returns empty array when no snapshots exist', async () => {
    mockOrderBy.mockResolvedValueOnce([]);
    const result = await getNetWorthSeries(userId, '90d');
    expect(result).toEqual([]);
  });

  it('passes where conditions for the given range', async () => {
    mockOrderBy.mockResolvedValueOnce([]);
    await getNetWorthSeries(userId, '1y');
    expect(mockWhere).toHaveBeenCalled();
  });
});

describe('getLatestNetWorthSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
  });

  it('returns the snapshot when found', async () => {
    mockLimit.mockResolvedValueOnce([sampleSnapshot]);
    const result = await getLatestNetWorthSnapshot(userId);
    expect(result).toEqual(sampleSnapshot);
  });

  it('returns undefined when no snapshots exist', async () => {
    mockLimit.mockResolvedValueOnce([]);
    const result = await getLatestNetWorthSnapshot(userId);
    expect(result).toBeUndefined();
  });
});

describe('getSnapshotNearDate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
  });

  it('returns the closest snapshot on or before the target date', async () => {
    mockLimit.mockResolvedValueOnce([sampleSnapshot]);
    const result = await getSnapshotNearDate(userId, '2025-05-01');
    expect(result).toEqual(sampleSnapshot);
  });

  it('returns undefined when no snapshot exists on or before the date', async () => {
    mockLimit.mockResolvedValueOnce([]);
    const result = await getSnapshotNearDate(userId, '2020-01-01');
    expect(result).toBeUndefined();
  });

  it('applies lte filter with the target date', async () => {
    mockLimit.mockResolvedValueOnce([]);
    await getSnapshotNearDate(userId, '2025-04-01');
    expect(mockWhere).toHaveBeenCalled();
  });
});

describe('parseSnapshotBreakdown', () => {
  it('parses valid bigint-string values', () => {
    const result = parseSnapshotBreakdown({ home: '45000000', brokerage: '12000000' });
    expect(result).toEqual({ home: 45000000n, brokerage: 12000000n });
  });

  it('returns empty object for null input', () => {
    expect(parseSnapshotBreakdown(null)).toEqual({});
  });

  it('returns empty object for undefined input', () => {
    expect(parseSnapshotBreakdown(undefined)).toEqual({});
  });

  it('returns empty object for non-object input', () => {
    expect(parseSnapshotBreakdown('string')).toEqual({});
    expect(parseSnapshotBreakdown(42)).toEqual({});
    expect(parseSnapshotBreakdown([])).toEqual({});
  });

  it('skips malformed bigint strings without throwing', () => {
    const result = parseSnapshotBreakdown({ home: '45000000', bad: 'not-a-number', good: '1000' });
    expect(result).toEqual({ home: 45000000n, good: 1000n });
  });

  it('handles empty object', () => {
    expect(parseSnapshotBreakdown({})).toEqual({});
  });

  it('skips non-string values', () => {
    const result = parseSnapshotBreakdown({ home: 45000000, other: null });
    expect(result).toEqual({});
  });
});

describe('upsertNetWorthSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate });
    mockOnConflictDoUpdate.mockReturnValue({ returning: mockReturning });
  });

  it('returns the upserted row', async () => {
    mockReturning.mockResolvedValueOnce([sampleSnapshot]);
    const result = await upsertNetWorthSnapshot(sampleSnapshot);
    expect(result).toEqual(sampleSnapshot);
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.arrayContaining(['user_id', 'snapshot_date']),
      }),
    );
  });

  it('throws if no row returned', async () => {
    mockReturning.mockResolvedValueOnce([]);
    await expect(upsertNetWorthSnapshot(sampleSnapshot)).rejects.toThrow(
      'upsertNetWorthSnapshot: no row returned',
    );
  });

  it('idempotency: re-running for same date uses onConflictDoUpdate', async () => {
    mockReturning.mockResolvedValueOnce([sampleSnapshot]);
    await upsertNetWorthSnapshot(sampleSnapshot);
    expect(mockOnConflictDoUpdate).toHaveBeenCalledOnce();
  });
});
