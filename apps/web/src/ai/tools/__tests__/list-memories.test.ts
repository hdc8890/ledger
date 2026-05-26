import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/ai/memory', () => ({
  listMemories: vi.fn(),
}));

import { listMemories } from '@/ai/memory';
import { handler, inputSchema } from '../list-memories';

const ctx = { userId: brand<UserId>('user-1') };

const createdAt = new Date('2024-03-15T00:00:00Z');

const sampleRows = [
  {
    id: 'mem-1',
    userId: 'user-1',
    kind: 'preference' as const,
    text: 'Costco should be Groceries',
    embedding: null as number[] | null,
    metadata: null,
    confidence: 1.0,
    expiresAt: null,
    createdAt,
    updatedAt: createdAt,
  },
  {
    id: 'mem-2',
    userId: 'user-1',
    kind: 'household_rule' as const,
    text: 'Vacation expenses excluded from savings goals',
    embedding: null as number[] | null,
    metadata: null,
    confidence: 0.9,
    expiresAt: null,
    createdAt,
    updatedAt: createdAt,
  },
];

describe('list-memories handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns mapped memories with ISO createdAt strings', async () => {
    vi.mocked(listMemories).mockResolvedValueOnce(sampleRows);

    const result = await handler({ limit: 20, offset: 0 }, ctx);

    expect(listMemories).toHaveBeenCalledWith(ctx.userId, undefined, 20, 0);
    expect(result.count).toBe(2);
    expect(result.memories[0]).toEqual({
      id: 'mem-1',
      text: 'Costco should be Groceries',
      kind: 'preference',
      confidence: 1.0,
      createdAt: createdAt.toISOString(),
    });
    // Embeddings must NOT be present in the output
    expect(result.memories[0]).not.toHaveProperty('embedding');
  });

  it('passes kind filter to listMemories', async () => {
    vi.mocked(listMemories).mockResolvedValueOnce([sampleRows[0]!]);

    const result = await handler({ kind: 'preference', limit: 20, offset: 0 }, ctx);

    expect(listMemories).toHaveBeenCalledWith(ctx.userId, 'preference', 20, 0);
    expect(result.count).toBe(1);
  });

  it('passes custom limit and offset', async () => {
    vi.mocked(listMemories).mockResolvedValueOnce([]);

    await handler({ limit: 5, offset: 10 }, ctx);

    expect(listMemories).toHaveBeenCalledWith(ctx.userId, undefined, 5, 10);
  });

  it('returns empty list when no memories exist', async () => {
    vi.mocked(listMemories).mockResolvedValueOnce([]);

    const result = await handler({ limit: 20, offset: 0 }, ctx);

    expect(result).toEqual({ memories: [], count: 0 });
  });
});

describe('list-memories inputSchema', () => {
  it('rejects limit greater than 50', () => {
    const result = inputSchema.safeParse({ limit: 51, offset: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects limit of zero', () => {
    const result = inputSchema.safeParse({ limit: 0, offset: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative offset', () => {
    const result = inputSchema.safeParse({ limit: 10, offset: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts valid input with defaults applied', () => {
    const result = inputSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });
});
