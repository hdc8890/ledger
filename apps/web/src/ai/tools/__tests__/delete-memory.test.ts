import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/ai/memory', () => ({
  deleteMemory: vi.fn(),
}));

import { deleteMemory } from '@/ai/memory';
import { handler, inputSchema } from '../delete-memory';

const ctx = { userId: brand<UserId>('user-1') };

describe('delete-memory handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes the memory and returns the id with deleted=true', async () => {
    vi.mocked(deleteMemory).mockResolvedValueOnce(undefined);

    const result = await handler({ id: 'memory-abc' }, ctx);

    expect(deleteMemory).toHaveBeenCalledWith(ctx.userId, 'memory-abc');
    expect(result).toEqual({ memoryId: 'memory-abc', deleted: true });
  });

  it('propagates errors from deleteMemory (e.g. not found)', async () => {
    vi.mocked(deleteMemory).mockRejectedValueOnce(new Error('not found'));

    await expect(handler({ id: 'missing-id' }, ctx)).rejects.toThrow('not found');
  });
});

describe('delete-memory inputSchema', () => {
  it('rejects empty id string', () => {
    const result = inputSchema.safeParse({ id: '' });
    expect(result.success).toBe(false);
  });

  it('accepts a valid non-empty id', () => {
    const result = inputSchema.safeParse({ id: 'memory-uuid-123' });
    expect(result.success).toBe(true);
  });
});
