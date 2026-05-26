import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/ai/memory', () => ({
  saveMemory: vi.fn(),
}));

import { saveMemory } from '@/ai/memory';
import { handler, inputSchema } from '../save-memory';

const ctx = { userId: brand<UserId>('user-1') };

const sampleMemoryRow = {
  id: 'memory-1',
  userId: 'user-1',
  kind: 'preference' as const,
  text: 'Costco should be Groceries',
  embedding: null as number[] | null,
  metadata: null,
  confidence: 1.0,
  expiresAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('save-memory handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('saves a memory and returns memoryId, text, and kind', async () => {
    vi.mocked(saveMemory).mockResolvedValueOnce(sampleMemoryRow);

    const result = await handler(
      { text: 'Costco should be Groceries', kind: 'preference' },
      ctx,
    );

    expect(saveMemory).toHaveBeenCalledWith(
      ctx.userId,
      'preference',
      'Costco should be Groceries',
      undefined,
    );
    expect(result).toEqual({
      memoryId: 'memory-1',
      text: 'Costco should be Groceries',
      kind: 'preference',
    });
  });

  it('passes metadata through to saveMemory', async () => {
    vi.mocked(saveMemory).mockResolvedValueOnce({
      ...sampleMemoryRow,
      kind: 'override_note' as const,
      metadata: { related_asset_id: 'asset-1' },
    });

    await handler(
      {
        text: 'Home value manually set',
        kind: 'override_note',
        metadata: { related_asset_id: 'asset-1' },
      },
      ctx,
    );

    expect(saveMemory).toHaveBeenCalledWith(
      ctx.userId,
      'override_note',
      'Home value manually set',
      { related_asset_id: 'asset-1' },
    );
  });

  it('propagates errors from saveMemory', async () => {
    vi.mocked(saveMemory).mockRejectedValueOnce(new Error('embedding failed'));

    await expect(
      handler({ text: 'Some preference', kind: 'goal' }, ctx),
    ).rejects.toThrow('embedding failed');
  });
});

describe('save-memory inputSchema', () => {
  it('rejects empty text', () => {
    const result = inputSchema.safeParse({ text: '', kind: 'preference' });
    expect(result.success).toBe(false);
  });

  it('rejects text longer than 1000 characters', () => {
    const result = inputSchema.safeParse({ text: 'a'.repeat(1001), kind: 'preference' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid kind value', () => {
    const result = inputSchema.safeParse({ text: 'some text', kind: 'invalid_kind' });
    expect(result.success).toBe(false);
  });

  it('accepts valid input without metadata', () => {
    const result = inputSchema.safeParse({ text: 'valid text', kind: 'household_rule' });
    expect(result.success).toBe(true);
  });
});
