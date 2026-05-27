import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId, MemoryId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Mock the embedding model — never call the real OpenAI API in tests.
// ---------------------------------------------------------------------------
vi.mock('ai', () => ({
  embed: vi.fn(),
}));
vi.mock('@ai-sdk/openai', () => ({
  openai: { embedding: vi.fn(() => 'mock-embedding-model') },
}));

// Mock all repository functions used by memory.ts
vi.mock('@/db/queries/memories', () => ({
  insertMemory: vi.fn(),
  updateMemory: vi.fn(),
  updateMemoryEmbedding: vi.fn(),
  getMemoryById: vi.fn(),
  retrieveMemoriesBySimilarity: vi.fn(),
  deleteMemory: vi.fn(),
  listMemories: vi.fn(),
}));

// Mock audit event insertion — never write to a real DB in tests.
vi.mock('@/db/queries/audit-events', () => ({
  insertAuditEvent: vi.fn(),
}));

import { embed } from 'ai';
import {
  insertMemory,
  updateMemory as dbUpdateMemory,
  updateMemoryEmbedding,
  getMemoryById as dbGetMemoryById,
  retrieveMemoriesBySimilarity,
  deleteMemory as dbDeleteMemory,
  listMemories as dbListMemories,
} from '@/db/queries/memories';
import { insertAuditEvent } from '@/db/queries/audit-events';
import {
  saveMemory,
  retrieveMemories,
  deleteMemory,
  listMemories,
  updateMemoryText,
  validateMemoryText,
} from '../memory';

const userId = brand<UserId>('user-uuid');
const memoryId = brand<MemoryId>('memory-uuid');
const fakeEmbedding = Array.from({ length: 1536 }, (_, i) => i / 1536);

const sampleMemoryRow = {
  id: 'memory-uuid',
  userId: 'user-uuid',
  kind: 'preference' as const,
  text: 'Costco should be Groceries',
  embedding: null as number[] | null,
  metadata: null,
  confidence: 1.0,
  expiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// saveMemory
// ---------------------------------------------------------------------------
describe('saveMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(embed).mockResolvedValue({
      embedding: fakeEmbedding,
      value: 'Costco should be Groceries',
      usage: { tokens: 10 },
      warnings: [],
    });
    vi.mocked(insertMemory).mockResolvedValue(sampleMemoryRow);
    vi.mocked(updateMemoryEmbedding).mockResolvedValue(undefined);
    vi.mocked(insertAuditEvent).mockResolvedValue({
      id: 'audit-uuid',
      actor: 'user-uuid',
      action: 'memory.create',
      entityType: 'memory',
      entityId: 'memory-uuid',
      before: null,
      after: null,
      source: 'ai',
      confidence: 1.0,
      at: new Date(),
    });
  });

  it('inserts the memory row and then sets the embedding', async () => {
    const result = await saveMemory(userId, 'preference', 'Costco should be Groceries');

    expect(insertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        kind: 'preference',
        text: 'Costco should be Groceries',
        confidence: 1.0,
      }),
    );
    expect(embed).toHaveBeenCalledOnce();
    expect(updateMemoryEmbedding).toHaveBeenCalledWith(memoryId, fakeEmbedding);
    expect(result.embedding).toEqual(fakeEmbedding);
    expect(insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'memory.create', source: 'ai', entityType: 'memory' }),
    );
  });

  it('passes metadata and confidence through to insertMemory', async () => {
    await saveMemory(
      userId,
      'override_note',
      'Home value manually set',
      { related_asset_id: 'asset-1' },
      0.9,
    );
    expect(insertMemory).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { related_asset_id: 'asset-1' },
        confidence: 0.9,
      }),
    );
  });

  it('still inserts if embed fails (propagates error)', async () => {
    vi.mocked(embed).mockRejectedValueOnce(new Error('OpenAI error'));
    await expect(
      saveMemory(userId, 'goal', 'Save for a vacation'),
    ).rejects.toThrow('OpenAI error');
    // insertMemory was still called (row exists in DB even if embedding fails)
    expect(insertMemory).toHaveBeenCalledOnce();
  });

  it('throws when embedding has wrong dimension', async () => {
    vi.mocked(embed).mockResolvedValueOnce({
      embedding: [0.1, 0.2, 0.3], // too short — not 1536
      value: 'test',
      usage: { tokens: 1 },
      warnings: [],
    });
    await expect(saveMemory(userId, 'preference', 'test')).rejects.toThrow(
      'expected 1536-dim embedding',
    );
  });
});

// ---------------------------------------------------------------------------
// retrieveMemories
// ---------------------------------------------------------------------------
describe('retrieveMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(embed).mockResolvedValue({
      embedding: fakeEmbedding,
      value: 'groceries preference',
      usage: { tokens: 5 },
      warnings: [],
    });
    vi.mocked(retrieveMemoriesBySimilarity).mockResolvedValue([sampleMemoryRow]);
  });

  it('embeds the query and returns similar memories', async () => {
    const result = await retrieveMemories(userId, 'groceries preference');

    expect(embed).toHaveBeenCalledOnce();
    expect(retrieveMemoriesBySimilarity).toHaveBeenCalledWith(
      userId,
      fakeEmbedding,
      10,  // default k
      0.0, // default threshold
    );
    expect(result).toEqual([sampleMemoryRow]);
  });

  it('passes custom k and confidenceThreshold', async () => {
    await retrieveMemories(userId, 'query', 5, 0.7);
    expect(retrieveMemoriesBySimilarity).toHaveBeenCalledWith(userId, fakeEmbedding, 5, 0.7);
  });

  it('returns empty array when no similar memories exist', async () => {
    vi.mocked(retrieveMemoriesBySimilarity).mockResolvedValueOnce([]);
    const result = await retrieveMemories(userId, 'something obscure');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deleteMemory
// ---------------------------------------------------------------------------
describe('deleteMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dbGetMemoryById).mockResolvedValue(sampleMemoryRow);
    vi.mocked(dbDeleteMemory).mockResolvedValue(undefined);
    vi.mocked(insertAuditEvent).mockResolvedValue({
      id: 'audit-uuid',
      actor: 'user-uuid',
      action: 'memory.delete',
      entityType: 'memory',
      entityId: 'memory-uuid',
      before: null,
      after: null,
      source: 'user',
      confidence: null,
      at: new Date(),
    });
  });

  it('delegates to the DB delete with id and userId', async () => {
    await deleteMemory(userId, memoryId);
    expect(dbDeleteMemory).toHaveBeenCalledWith(memoryId, userId);
  });

  it('records an audit event with the prior memory content', async () => {
    await deleteMemory(userId, memoryId);
    expect(insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'memory.delete',
        source: 'user',
        entityType: 'memory',
        before: expect.objectContaining({ kind: 'preference', text: 'Costco should be Groceries' }),
        after: null,
      }),
    );
  });

  it('records a null before when the memory is not found', async () => {
    vi.mocked(dbGetMemoryById).mockResolvedValueOnce(undefined);
    await deleteMemory(userId, memoryId);
    expect(insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ before: null }),
    );
  });
});

// ---------------------------------------------------------------------------
// listMemories
// ---------------------------------------------------------------------------
describe('listMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(dbListMemories).mockResolvedValue([sampleMemoryRow]);
  });

  it('returns memories via the db helper', async () => {
    const result = await listMemories(userId);
    expect(result).toEqual([sampleMemoryRow]);
    expect(dbListMemories).toHaveBeenCalledWith(userId, undefined, 50, 0);
  });

  it('passes kind filter through', async () => {
    await listMemories(userId, 'household_rule');
    expect(dbListMemories).toHaveBeenCalledWith(userId, 'household_rule', 50, 0);
  });

  it('passes custom limit and offset', async () => {
    await listMemories(userId, undefined, 20, 40);
    expect(dbListMemories).toHaveBeenCalledWith(userId, undefined, 20, 40);
  });
});

// ---------------------------------------------------------------------------
// validateMemoryText
// ---------------------------------------------------------------------------
describe('validateMemoryText', () => {
  it('allows semantic text with no financial data', () => {
    expect(() => validateMemoryText('Costco should be categorized as Groceries')).not.toThrow();
    expect(() => validateMemoryText('User prefers dark mode')).not.toThrow();
    expect(() => validateMemoryText('The home value has been manually set by the user')).not.toThrow();
    expect(() => validateMemoryText('Save for a vacation')).not.toThrow();
  });

  it('blocks raw dollar amounts', () => {
    expect(() => validateMemoryText('Balance is $1,234.56')).toThrow('raw dollar amount');
    expect(() => validateMemoryText('Saved $50000')).toThrow('raw dollar amount');
    expect(() => validateMemoryText('Cost: $9.99')).toThrow('raw dollar amount');
  });

  it('blocks long digit sequences resembling account numbers', () => {
    expect(() => validateMemoryText('Account 12345678')).toThrow('long digit sequence');
    expect(() => validateMemoryText('Card 4532123456789012')).toThrow('long digit sequence');
  });

  it('allows short digit sequences (years, zip codes, etc.)', () => {
    expect(() => validateMemoryText('Since 2022')).not.toThrow();
    expect(() => validateMemoryText('ZIP 94103')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// updateMemoryText
// ---------------------------------------------------------------------------
describe('updateMemoryText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(embed).mockResolvedValue({
      embedding: fakeEmbedding,
      value: 'new text',
      usage: { tokens: 5 },
      warnings: [],
    });
    vi.mocked(dbGetMemoryById).mockResolvedValue(sampleMemoryRow);
    vi.mocked(dbUpdateMemory).mockResolvedValue({ ...sampleMemoryRow, text: 'new text' });
    vi.mocked(updateMemoryEmbedding).mockResolvedValue(undefined);
    vi.mocked(insertAuditEvent).mockResolvedValue({
      id: 'audit-uuid',
      actor: 'user-uuid',
      action: 'memory.update',
      entityType: 'memory',
      entityId: 'memory-uuid',
      before: null,
      after: null,
      source: 'user',
      confidence: 1.0,
      at: new Date(),
    });
  });

  it('validates text, updates DB, recomputes embedding, writes audit', async () => {
    const result = await updateMemoryText(userId, memoryId, 'Amazon orders should be Shopping');

    expect(dbUpdateMemory).toHaveBeenCalledWith(memoryId, userId, { text: 'Amazon orders should be Shopping' });
    expect(embed).toHaveBeenCalledOnce();
    expect(updateMemoryEmbedding).toHaveBeenCalledWith(memoryId, fakeEmbedding);
    expect(insertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'memory.update', source: 'user' }),
    );
    expect(result).toMatchObject({ text: 'new text', embedding: fakeEmbedding });
  });

  it('returns undefined when memory is not found', async () => {
    vi.mocked(dbUpdateMemory).mockResolvedValueOnce(undefined);
    const result = await updateMemoryText(userId, memoryId, 'some text');
    expect(result).toBeUndefined();
    expect(embed).not.toHaveBeenCalled();
  });

  it('throws when new text contains a dollar amount', async () => {
    await expect(updateMemoryText(userId, memoryId, 'Balance is $500')).rejects.toThrow(
      'raw dollar amount',
    );
    expect(dbUpdateMemory).not.toHaveBeenCalled();
  });
});
