import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before vi.mock() factories run.
// ---------------------------------------------------------------------------
const {
  mockReturning,
  mockInsert,
  mockValues,
  mockSelect,
  mockFrom,
  mockWhere,
  mockOrderBy,
  mockLimit,
  mockOffset,
  mockUpdate,
  mockSet,
  mockWhereUpdate,
  mockDelete,
  mockWhereDelete,
} = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockOffset = vi.fn();
  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn();
  const mockWhere = vi.fn();
  const mockFrom = vi.fn();
  const mockSelect = vi.fn();
  const mockValues = vi.fn();
  const mockInsert = vi.fn();
  const mockWhereUpdate = vi.fn();
  const mockSet = vi.fn();
  const mockUpdate = vi.fn();
  const mockWhereDelete = vi.fn();
  const mockDelete = vi.fn();
  return {
    mockReturning,
    mockInsert,
    mockValues,
    mockSelect,
    mockFrom,
    mockWhere,
    mockOrderBy,
    mockLimit,
    mockOffset,
    mockUpdate,
    mockSet,
    mockWhereUpdate,
    mockDelete,
    mockWhereDelete,
  };
});

vi.mock('@/lib/db', () => ({
  db: {
    insert: mockInsert,
    select: mockSelect,
    update: mockUpdate,
    delete: mockDelete,
  },
}));

vi.mock('@/db/schema', () => ({
  memories: {
    id: 'id',
    userId: 'user_id',
    kind: 'kind',
    text: 'text',
    embedding: 'embedding',
    metadata: 'metadata',
    confidence: 'confidence',
    expiresAt: 'expires_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  memoryProposals: {
    id: 'id',
    userId: 'user_id',
    proposedText: 'proposed_text',
    proposedKind: 'proposed_kind',
    sourceSessionId: 'source_session_id',
    status: 'status',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: unknown) => `${col}=${String(val)}`),
  and: vi.fn((...args: unknown[]) => args.join(' AND ')),
  or: vi.fn((...args: unknown[]) => args.join(' OR ')),
  gt: vi.fn((col: string, val: unknown) => `${col}>${String(val)}`),
  gte: vi.fn((col: string, val: unknown) => `${col}>=${String(val)}`),
  isNull: vi.fn((col: string) => `${col} IS NULL`),
  isNotNull: vi.fn((col: string) => `${col} IS NOT NULL`),
  asc: vi.fn((col: string) => `asc(${col})`),
  desc: vi.fn((col: string) => `desc(${col})`),
  sql: Object.assign(vi.fn(() => 'RAW_SQL'), { raw: vi.fn() }),
}));

import {
  insertMemory,
  updateMemoryEmbedding,
  getMemoryById,
  listMemories,
  updateMemory,
  deleteMemory,
  retrieveMemoriesBySimilarity,
  insertMemoryProposal,
  listPendingProposals,
  updateProposalStatus,
  getProposalById,
  hasRejectedProposalWithText,
} from '../memories';
import { brand } from '@/shared/types';
import type { UserId, MemoryId, MemoryProposalId, ChatSessionId } from '@/shared/types';

const userId = brand<UserId>('user-uuid');
const memoryId = brand<MemoryId>('memory-uuid');
const proposalId = brand<MemoryProposalId>('proposal-uuid');

const sampleMemory = {
  id: 'memory-uuid',
  userId: 'user-uuid',
  kind: 'preference' as const,
  text: 'Costco should be categorized as Groceries',
  embedding: null,
  metadata: null,
  confidence: 1.0,
  expiresAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sampleProposal = {
  id: 'proposal-uuid',
  userId: 'user-uuid',
  proposedText: 'User prefers dark mode',
  proposedKind: 'preference',
  sourceSessionId: null,
  status: 'pending' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ---------------------------------------------------------------------------
// insertMemory
// ---------------------------------------------------------------------------
describe('insertMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ returning: mockReturning });
  });

  it('returns the inserted memory row', async () => {
    mockReturning.mockResolvedValueOnce([sampleMemory]);
    const result = await insertMemory({
      userId,
      kind: 'preference',
      text: 'Costco should be categorized as Groceries',
    });
    expect(result).toEqual(sampleMemory);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'preference', text: 'Costco should be categorized as Groceries' }),
    );
  });

  it('defaults confidence to 1.0 when not provided', async () => {
    mockReturning.mockResolvedValueOnce([sampleMemory]);
    await insertMemory({ userId, kind: 'household_rule', text: 'some rule' });
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ confidence: 1.0 }),
    );
  });

  it('throws when no row is returned', async () => {
    mockReturning.mockResolvedValueOnce([]);
    await expect(
      insertMemory({ userId, kind: 'preference', text: 'test' }),
    ).rejects.toThrow('insertMemory: no row returned');
  });

  it('passes metadata when provided', async () => {
    mockReturning.mockResolvedValueOnce([sampleMemory]);
    await insertMemory({
      userId,
      kind: 'override_note',
      text: 'Asset updated',
      metadata: { source_txn_id: 'txn-1' },
    });
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { source_txn_id: 'txn-1' } }),
    );
  });
});

// ---------------------------------------------------------------------------
// updateMemoryEmbedding
// ---------------------------------------------------------------------------
describe('updateMemoryEmbedding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhereUpdate });
    mockWhereUpdate.mockResolvedValue(undefined);
  });

  it('calls update with the embedding and updatedAt', async () => {
    const embedding = [0.1, 0.2, 0.3];
    await updateMemoryEmbedding(memoryId, embedding);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ embedding, updatedAt: expect.any(Date) }),
    );
  });
});

// ---------------------------------------------------------------------------
// getMemoryById
// ---------------------------------------------------------------------------
describe('getMemoryById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
  });

  it('returns the memory when found', async () => {
    mockLimit.mockResolvedValueOnce([sampleMemory]);
    const result = await getMemoryById(memoryId);
    expect(result).toEqual(sampleMemory);
  });

  it('returns undefined when not found', async () => {
    mockLimit.mockResolvedValueOnce([]);
    const result = await getMemoryById(brand<MemoryId>('missing'));
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listMemories
// ---------------------------------------------------------------------------
describe('listMemories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ offset: mockOffset });
  });

  it('returns memories for the user', async () => {
    mockOffset.mockResolvedValueOnce([sampleMemory]);
    const result = await listMemories(userId);
    expect(result).toEqual([sampleMemory]);
  });

  it('filters by kind when provided', async () => {
    mockOffset.mockResolvedValueOnce([sampleMemory]);
    const result = await listMemories(userId, 'preference');
    expect(result).toEqual([sampleMemory]);
  });
});

// ---------------------------------------------------------------------------
// updateMemory
// ---------------------------------------------------------------------------
describe('updateMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhereUpdate });
    mockWhereUpdate.mockReturnValue({ returning: mockReturning });
  });

  it('returns the updated memory', async () => {
    const updated = { ...sampleMemory, text: 'Updated text' };
    mockReturning.mockResolvedValueOnce([updated]);
    const result = await updateMemory(memoryId, userId, { text: 'Updated text' });
    expect(result?.text).toBe('Updated text');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Updated text', updatedAt: expect.any(Date) }),
    );
  });

  it('returns undefined when memory not found', async () => {
    mockReturning.mockResolvedValueOnce([]);
    const result = await updateMemory(brand<MemoryId>('missing'), userId, { text: 'x' });
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// deleteMemory
// ---------------------------------------------------------------------------
describe('deleteMemory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDelete.mockReturnValue({ where: mockWhereDelete });
    mockWhereDelete.mockResolvedValue(undefined);
  });

  it('calls delete without throwing', async () => {
    await expect(deleteMemory(memoryId, userId)).resolves.toBeUndefined();
    expect(mockDelete).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// retrieveMemoriesBySimilarity
// ---------------------------------------------------------------------------
describe('retrieveMemoriesBySimilarity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
  });

  it('throws for NaN values in the embedding array', async () => {
    await expect(
      retrieveMemoriesBySimilarity(userId, [0.1, NaN, 0.3], 10),
    ).rejects.toThrow('embedding contains non-numeric values');
  });

  it('returns memories ordered by similarity', async () => {
    mockLimit.mockResolvedValueOnce([sampleMemory]);
    const result = await retrieveMemoriesBySimilarity(userId, [0.1, 0.2, 0.3], 10);
    expect(result).toEqual([sampleMemory]);
    expect(mockOrderBy).toHaveBeenCalledWith('RAW_SQL');
  });

  it('passes k as the limit', async () => {
    mockLimit.mockResolvedValueOnce([]);
    await retrieveMemoriesBySimilarity(userId, [0.1], 5);
    expect(mockLimit).toHaveBeenCalledWith(5);
  });
});

// ---------------------------------------------------------------------------
// insertMemoryProposal
// ---------------------------------------------------------------------------
describe('insertMemoryProposal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockReturnValue({ values: mockValues });
    mockValues.mockReturnValue({ returning: mockReturning });
  });

  it('returns the inserted proposal', async () => {
    mockReturning.mockResolvedValueOnce([sampleProposal]);
    const result = await insertMemoryProposal({
      userId,
      proposedText: 'User prefers dark mode',
      proposedKind: 'preference',
    });
    expect(result).toEqual(sampleProposal);
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ proposedText: 'User prefers dark mode', proposedKind: 'preference' }),
    );
  });

  it('passes sourceSessionId when provided', async () => {
    mockReturning.mockResolvedValueOnce([sampleProposal]);
    await insertMemoryProposal({
      userId,
      proposedText: 'test',
      proposedKind: 'goal',
      sourceSessionId: brand<ChatSessionId>('session-1'),
    });
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSessionId: 'session-1' }),
    );
  });

  it('throws when no row is returned', async () => {
    mockReturning.mockResolvedValueOnce([]);
    await expect(
      insertMemoryProposal({ userId, proposedText: 'x', proposedKind: 'preference' }),
    ).rejects.toThrow('insertMemoryProposal: no row returned');
  });
});

// ---------------------------------------------------------------------------
// listPendingProposals
// ---------------------------------------------------------------------------
describe('listPendingProposals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockResolvedValue([sampleProposal]);
  });

  it('returns pending proposals for the user', async () => {
    const result = await listPendingProposals(userId);
    expect(result).toEqual([sampleProposal]);
  });
});

// ---------------------------------------------------------------------------
// updateProposalStatus
// ---------------------------------------------------------------------------
describe('updateProposalStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ set: mockSet });
    mockSet.mockReturnValue({ where: mockWhereUpdate });
    mockWhereUpdate.mockReturnValue({ returning: mockReturning });
  });

  it('returns the updated proposal on accept', async () => {
    const accepted = { ...sampleProposal, status: 'accepted' as const };
    mockReturning.mockResolvedValueOnce([accepted]);
    const result = await updateProposalStatus(proposalId, userId, 'accepted');
    expect(result?.status).toBe('accepted');
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'accepted', updatedAt: expect.any(Date) }),
    );
  });

  it('returns undefined when proposal not found', async () => {
    mockReturning.mockResolvedValueOnce([]);
    const result = await updateProposalStatus(
      brand<MemoryProposalId>('missing'),
      userId,
      'rejected',
    );
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getProposalById
// ---------------------------------------------------------------------------
describe('getProposalById', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ then: undefined }); // handled via mockResolvedValueOnce
  });

  it('returns the matching proposal row', async () => {
    mockLimit.mockResolvedValueOnce([sampleProposal]);
    const result = await getProposalById(proposalId);
    expect(result).toEqual(sampleProposal);
  });

  it('returns undefined when no matching proposal', async () => {
    mockLimit.mockResolvedValueOnce([]);
    const result = await getProposalById(brand<MemoryProposalId>('nonexistent'));
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// hasRejectedProposalWithText
// ---------------------------------------------------------------------------
describe('hasRejectedProposalWithText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
  });

  it('returns true when a rejected proposal with the same text exists', async () => {
    mockLimit.mockResolvedValueOnce([sampleProposal]);
    const result = await hasRejectedProposalWithText(userId, 'User prefers dark mode');
    expect(result).toBe(true);
  });

  it('returns false when no rejected proposal with that text exists', async () => {
    mockLimit.mockResolvedValueOnce([]);
    const result = await hasRejectedProposalWithText(userId, 'Unknown text');
    expect(result).toBe(false);
  });
});
