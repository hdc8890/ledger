import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UserId } from '@/shared/types';

const { mockFrom, mockSelect, mockWhere, mockLimit } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockWhere = vi.fn(() => ({ limit: mockLimit }));
  const mockFrom = vi.fn();
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockFrom, mockSelect, mockWhere, mockLimit };
});

vi.mock('@/lib/db', () => ({
  db: {
    select: mockSelect,
  },
}));

vi.mock('@/db/schema', () => ({
  users: { id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col} = ${val}`),
}));

import { getAllUsers, getUserById } from '../users';

const USER_ID = 'uuid-1' as UserId;
const sampleRow = {
  id: USER_ID,
  name: null,
  email: 'test@example.com',
  emailVerified: null,
  image: null,
  householdId: null,
  settings: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('getAllUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all user rows', async () => {
    mockFrom.mockResolvedValueOnce([sampleRow]);

    const result = await getAllUsers();

    expect(result).toEqual([sampleRow]);
    expect(mockSelect).toHaveBeenCalledOnce();
    expect(mockFrom).toHaveBeenCalledWith({ id: 'id' });
  });
});

describe('getUserById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ where: mockWhere });
  });

  it('returns the row when found', async () => {
    mockLimit.mockResolvedValueOnce([sampleRow]);

    const result = await getUserById(USER_ID);

    expect(result).toEqual(sampleRow);
    expect(mockWhere).toHaveBeenCalledWith(`id = ${USER_ID}`);
    expect(mockLimit).toHaveBeenCalledWith(1);
  });

  it('throws when no row is found', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await expect(getUserById(USER_ID)).rejects.toThrow(`User not found: ${USER_ID}`);
  });
});
