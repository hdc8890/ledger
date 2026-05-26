import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockReturning,
  mockOnConflictDoUpdate,
  mockValues,
  mockInsert,
  mockOrderBy,
  mockSelect,
  mockWhere,
  mockLimit,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }));
  const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate, returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockOrderBy = vi.fn();
  const mockSelect = vi.fn();
  return {
    mockReturning,
    mockOnConflictDoUpdate,
    mockValues,
    mockInsert,
    mockOrderBy,
    mockSelect,
    mockWhere,
    mockLimit,
  };
});

vi.mock('@/lib/db', () => ({ db: { insert: mockInsert, select: mockSelect } }));
vi.mock('@/db/schema', () => ({
  merchantAliases: {
    rawPattern: 'raw_pattern',
    id: 'id',
    priority: 'priority',
  },
}));
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
  desc: vi.fn((col: string) => `${col} desc`),
}));

import {
  insertMerchantAlias,
  upsertMerchantAlias,
  getAllMerchantAliases,
  getMerchantAliasByPattern,
} from '../merchant-aliases';

const SAMPLE: ReturnType<typeof sampleAlias> = sampleAlias();
function sampleAlias(overrides?: Record<string, unknown>) {
  return {
    id: 'alias-uuid',
    rawPattern: 'starbucks',
    canonical: 'Starbucks',
    categoryHint: 'Food & Drink',
    priority: 0,
    createdBy: 'seed' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('insertMerchantAlias', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the inserted row', async () => {
    mockReturning.mockResolvedValueOnce([SAMPLE]);
    const result = await insertMerchantAlias(SAMPLE);
    expect(result).toEqual(SAMPLE);
    expect(mockValues).toHaveBeenCalledWith(SAMPLE);
  });

  it('throws if no row returned', async () => {
    mockReturning.mockResolvedValueOnce([]);
    await expect(insertMerchantAlias(SAMPLE)).rejects.toThrow('insertMerchantAlias: no row returned');
  });
});

describe('upsertMerchantAlias', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the upserted row', async () => {
    mockReturning.mockResolvedValueOnce([SAMPLE]);
    const result = await upsertMerchantAlias(SAMPLE);
    expect(result).toEqual(SAMPLE);
    expect(mockOnConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'raw_pattern' }),
    );
  });

  it('throws if no row returned', async () => {
    mockReturning.mockResolvedValueOnce([]);
    await expect(upsertMerchantAlias(SAMPLE)).rejects.toThrow('upsertMerchantAlias: no row returned');
  });
});

describe('getAllMerchantAliases', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns rows ordered by priority desc', async () => {
    const from = vi.fn(() => ({ orderBy: mockOrderBy }));
    mockSelect.mockReturnValueOnce({ from });
    mockOrderBy.mockResolvedValueOnce([SAMPLE]);
    const result = await getAllMerchantAliases();
    expect(result).toEqual([SAMPLE]);
    expect(mockOrderBy).toHaveBeenCalledWith('priority desc');
  });
});

describe('getMerchantAliasByPattern', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns first matching row', async () => {
    const from = vi.fn(() => ({ where: mockWhere }));
    mockSelect.mockReturnValueOnce({ from });
    mockLimit.mockResolvedValueOnce([SAMPLE]);
    const result = await getMerchantAliasByPattern('starbucks');
    expect(result).toEqual(SAMPLE);
  });

  it('returns undefined when no match', async () => {
    const from = vi.fn(() => ({ where: mockWhere }));
    mockSelect.mockReturnValueOnce({ from });
    mockLimit.mockResolvedValueOnce([]);
    const result = await getMerchantAliasByPattern('unknown-merchant');
    expect(result).toBeUndefined();
  });
});
