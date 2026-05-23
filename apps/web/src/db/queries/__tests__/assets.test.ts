import { describe, it, expect, vi, beforeEach } from 'vitest';

// All mocks use bare vi.fn() (no typed implementation) so mockReturnValueOnce
// accepts any value without conflicting with inferred return types.
const {
  mockReturning,
  mockSelect,
  mockFrom,
  mockWhere,
  mockWhereOrderBy,
  mockLimit,
  mockGroupBy,
  mockGroupByOrderBy,
  mockWhereUpdate,
  mockInsert,
  mockValues,
  mockOnConflictDoUpdate,
  mockUpdate,
  mockSet,
  mockWhereDelete,
  mockDelete,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockLimit = vi.fn();
  const mockGroupByOrderBy = vi.fn();
  const mockGroupBy = vi.fn();
  const mockWhereOrderBy = vi.fn();
  const mockWhere = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  const mockOnConflictDoUpdate = vi.fn();
  const mockValues = vi.fn();
  const mockInsert = vi.fn();
  const mockWhereUpdate = vi.fn();
  const mockSet = vi.fn();
  const mockUpdate = vi.fn();
  const mockWhereDelete = vi.fn();
  const mockDelete = vi.fn();
  return {
    mockReturning,
    mockSelect,
    mockFrom,
    mockWhere,
    mockWhereOrderBy,
    mockLimit,
    mockGroupBy,
    mockGroupByOrderBy,
    mockWhereUpdate,
    mockInsert,
    mockValues,
    mockOnConflictDoUpdate,
    mockUpdate,
    mockSet,
    mockWhereDelete,
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
  assets: { id: 'id', userId: 'user_id', kind: 'kind', valueCents: 'value_cents', createdAt: 'created_at' },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
  asc: vi.fn((col: string) => `asc(${col})`),
  desc: vi.fn((col: string) => `desc(${col})`),
  sql: Object.assign(vi.fn(), { raw: vi.fn() }),
}));

import {
  getAssetsByUserId,
  getAssetById,
  getAssetBreakdown,
  insertAsset,
  updateAsset,
  deleteAsset,
} from '../assets';
import { brand } from '@/shared/types';
import type { AssetId, UserId } from '@/shared/types';

const userId = brand<UserId>('user-uuid');
const assetId = brand<AssetId>('asset-uuid');

const sampleAsset = {
  id: 'asset-uuid',
  userId: 'user-uuid',
  kind: 'home' as const,
  name: 'Primary Residence',
  valueCents: 45000000n,
  source: 'user' as const,
  confidence: 1.0,
  manualOverride: true,
  metadata: { address: '123 Main St' },
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('getAssetsByUserId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockWhereOrderBy });
  });

  it('returns assets for the given user', async () => {
    mockWhereOrderBy.mockResolvedValueOnce([sampleAsset]);
    const result = await getAssetsByUserId(userId);
    expect(result).toEqual([sampleAsset]);
    expect(mockWhere).toHaveBeenCalledWith('user_id=user-uuid');
  });
});

describe('getAssetById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
  });

  it('returns the asset when found', async () => {
    mockLimit.mockResolvedValueOnce([sampleAsset]);
    const result = await getAssetById(assetId);
    expect(result).toEqual(sampleAsset);
  });

  it('returns undefined when not found', async () => {
    mockLimit.mockResolvedValueOnce([]);
    const result = await getAssetById(brand<AssetId>('missing-uuid'));
    expect(result).toBeUndefined();
  });
});

describe('getAssetBreakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ groupBy: mockGroupBy });
    mockGroupBy.mockReturnValue({ orderBy: mockGroupByOrderBy });
  });

  it('maps grouped rows to AssetBreakdown with bigint totalCents', async () => {
    mockGroupByOrderBy.mockResolvedValueOnce([
      { kind: 'home', totalCents: '45000000', count: 1 },
      { kind: 'brokerage', totalCents: '12000000', count: 2 },
    ]);
    const result = await getAssetBreakdown(userId);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ kind: 'home', totalCents: 45000000n, count: 1 });
    expect(result[1]).toMatchObject({ kind: 'brokerage', totalCents: 12000000n, count: 2 });
  });

  it('handles null sum (no assets) as 0n', async () => {
    mockGroupByOrderBy.mockResolvedValueOnce([{ kind: 'cash', totalCents: null, count: 0 }]);
    const result = await getAssetBreakdown(userId);
    expect(result[0]?.totalCents).toBe(0n);
  });
});

describe('insertAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ onConflictDoUpdate: mockOnConflictDoUpdate, returning: mockReturning });
  });

  it('returns the inserted asset row', async () => {
    mockReturning.mockResolvedValueOnce([sampleAsset]);
    const result = await insertAsset(sampleAsset);
    expect(result).toEqual(sampleAsset);
    expect(mockValues).toHaveBeenCalledWith(sampleAsset);
  });

  it('throws if no row returned', async () => {
    mockReturning.mockResolvedValueOnce([]);
    await expect(insertAsset(sampleAsset)).rejects.toThrow('insertAsset: no row returned');
  });
});

describe('updateAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhereUpdate });
    mockWhereUpdate.mockReturnValue({ returning: mockReturning });
  });

  it('calls set with patch + updatedAt and returns updated row', async () => {
    mockReturning.mockResolvedValueOnce([{ ...sampleAsset, name: 'Updated Name' }]);
    const result = await updateAsset(assetId, { name: 'Updated Name' });
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Updated Name', updatedAt: expect.any(Date) }),
    );
    expect(result?.name).toBe('Updated Name');
  });

  it('returns undefined when asset not found', async () => {
    mockReturning.mockResolvedValueOnce([]);
    const result = await updateAsset(brand<AssetId>('missing-uuid'), { name: 'x' });
    expect(result).toBeUndefined();
  });
});

describe('deleteAsset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDelete.mockReturnValue({ where: mockWhereDelete });
  });

  it('calls delete.where without throwing', async () => {
    await expect(deleteAsset(assetId)).resolves.toBeUndefined();
  });
});
