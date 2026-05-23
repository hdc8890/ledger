import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted ensures these are defined before vi.mock factories run.
// ---------------------------------------------------------------------------
const { mockReturning, mockValues, mockInsert, mockLimit, mockSelect } =
  vi.hoisted(() => {
    const mockReturning = vi.fn();
    const mockOnConflictDoUpdate = vi.fn(() => ({ returning: mockReturning }));
    const mockValues = vi.fn(() => ({ onConflictDoUpdate: mockOnConflictDoUpdate }));
    const mockInsert = vi.fn(() => ({ values: mockValues }));
    const mockLimit = vi.fn();
    const mockWhere = vi.fn(() => ({ limit: mockLimit }));
    const mockSelect = vi.fn(() => ({ from: vi.fn(() => ({ where: mockWhere })) }));
    return { mockReturning, mockValues, mockInsert, mockLimit, mockSelect };
  });

vi.mock('@/lib/db', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
  },
}));

vi.mock('@/db/schema', () => ({
  users: { clerkId: 'clerk_id', id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col} = ${val}`),
}));

import { upsertUserByClerkId, findUserByClerkId } from '../users';

const sampleRow = {
  id: 'uuid-1',
  clerkId: 'clerk_abc',
  householdId: null,
  settings: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('upsertUserByClerkId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the row on successful insert', async () => {
    mockReturning.mockResolvedValueOnce([sampleRow]);

    const result = await upsertUserByClerkId({ clerkId: 'clerk_abc' });

    expect(result).toEqual(sampleRow);
    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ clerkId: 'clerk_abc' }),
    );
  });

  it('throws if no row is returned', async () => {
    mockReturning.mockResolvedValueOnce([]);

    await expect(upsertUserByClerkId({ clerkId: 'clerk_abc' })).rejects.toThrow(
      'upsertUserByClerkId: no row returned',
    );
  });

  it('passes householdId when provided', async () => {
    mockReturning.mockResolvedValueOnce([{ ...sampleRow, householdId: 'hh-1' }]);

    await upsertUserByClerkId({ clerkId: 'clerk_abc', householdId: 'hh-1' });

    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: 'hh-1' }),
    );
  });
});

describe('findUserByClerkId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns undefined when no row found', async () => {
    mockLimit.mockResolvedValueOnce([]);

    const result = await findUserByClerkId('clerk_xyz');

    expect(result).toBeUndefined();
  });

  it('returns the row when found', async () => {
    mockLimit.mockResolvedValueOnce([sampleRow]);

    const result = await findUserByClerkId('clerk_abc');

    expect(result).toEqual(sampleRow);
  });
});
