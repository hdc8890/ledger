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
