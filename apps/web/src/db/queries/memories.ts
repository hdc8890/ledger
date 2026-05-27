import { and, asc, desc, eq, gte, gt, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { memories, memoryProposals } from '@/db/schema';
import type { UserId, MemoryId, MemoryProposalId, ChatSessionId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MemoryRow = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;

export type MemoryProposalRow = typeof memoryProposals.$inferSelect;
export type NewMemoryProposal = typeof memoryProposals.$inferInsert;

export type MemoryKind =
  | 'preference'
  | 'household_rule'
  | 'historical_context'
  | 'goal'
  | 'override_note';

export type MemoryProposalStatus = 'pending' | 'accepted' | 'rejected';

// ---------------------------------------------------------------------------
// Memory CRUD
// ---------------------------------------------------------------------------

/**
 * Insert a new memory row. Embedding may be null if it hasn't been computed
 * yet — the caller is responsible for calling updateMemoryEmbedding() after
 * the embedding is ready.
 *
 * IMPORTANT: text must be semantic — no raw amounts, account numbers, or
 * institution names. Caller is responsible for sanitization.
 */
export async function insertMemory(input: {
  readonly userId: UserId;
  readonly kind: MemoryKind;
  readonly text: string;
  readonly embedding?: number[];
  readonly metadata?: Record<string, unknown>;
  readonly confidence?: number;
  readonly expiresAt?: Date;
}): Promise<MemoryRow> {
  const rows = await db
    .insert(memories)
    .values({
      userId: input.userId,
      kind: input.kind,
      text: input.text,
      embedding: input.embedding ?? null,
      metadata: input.metadata ?? null,
      confidence: input.confidence ?? 1.0,
      expiresAt: input.expiresAt ?? null,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('insertMemory: no row returned');
  return row;
}

/**
 * Set or update the embedding vector for an existing memory.
 * Called after the embedding is computed asynchronously.
 */
export async function updateMemoryEmbedding(
  id: MemoryId,
  embedding: number[],
): Promise<void> {
  await db
    .update(memories)
    .set({ embedding, updatedAt: new Date() })
    .where(eq(memories.id, id));
}

/** Fetch a single memory by ID. Returns undefined if not found. */
export async function getMemoryById(id: MemoryId): Promise<MemoryRow | undefined> {
  const rows = await db.select().from(memories).where(eq(memories.id, id)).limit(1);
  return rows[0];
}

/**
 * List memories for a user, optionally filtered by kind.
 * Ordered by most recently created. Supports basic offset pagination.
 */
export async function listMemories(
  userId: UserId,
  kind?: MemoryKind,
  limit = 50,
  offset = 0,
): Promise<MemoryRow[]> {
  return db
    .select()
    .from(memories)
    .where(
      kind !== undefined
        ? and(eq(memories.userId, userId), eq(memories.kind, kind))
        : eq(memories.userId, userId),
    )
    .orderBy(desc(memories.createdAt))
    .limit(limit)
    .offset(offset);
}

/**
 * Update memory text and/or kind. Returns the updated row, or undefined
 * if the row does not exist or does not belong to this user.
 */
export async function updateMemory(
  id: MemoryId,
  userId: UserId,
  changes: {
    readonly text?: string;
    readonly kind?: MemoryKind;
    readonly confidence?: number;
  },
): Promise<MemoryRow | undefined> {
  const rows = await db
    .update(memories)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(memories.id, id), eq(memories.userId, userId)))
    .returning();
  return rows[0];
}

/**
 * Hard-delete a memory. Ownership check via userId.
 * This is a permanent deletion — there is no soft-delete for memories
 * because "forget that" must actually remove the data.
 */
export async function deleteMemory(id: MemoryId, userId: UserId): Promise<void> {
  await db
    .delete(memories)
    .where(and(eq(memories.id, id), eq(memories.userId, userId)));
}

/**
 * Hard-delete ALL memories for a user.
 * Called from the "Clear all" action in the Memory management UI.
 * This is a permanent, irreversible operation.
 */
export async function deleteAllMemories(userId: UserId): Promise<void> {
  await db.delete(memories).where(eq(memories.userId, userId));
}

// ---------------------------------------------------------------------------
// Vector similarity retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieve the top-K most semantically similar memories for a given user
 * using cosine distance (pgvector <=> operator).
 *
 * Filters:
 * - Only rows with a non-null embedding.
 * - Expired memories (expires_at < NOW()) are excluded.
 * - Rows below confidenceThreshold are excluded.
 *
 * Results are ordered by ascending cosine distance (most similar first).
 */
export async function retrieveMemoriesBySimilarity(
  userId: UserId,
  embedding: number[],
  k: number,
  confidenceThreshold = 0.0,
): Promise<MemoryRow[]> {
  if (!embedding.every(n => typeof n === 'number' && !Number.isNaN(n))) {
    throw new Error('retrieveMemoriesBySimilarity: embedding contains non-numeric values');
  }
  const vectorStr = `[${embedding.join(',')}]`;
  return db
    .select()
    .from(memories)
    .where(
      and(
        eq(memories.userId, userId),
        isNotNull(memories.embedding),
        or(isNull(memories.expiresAt), gt(memories.expiresAt, new Date())),
        gte(memories.confidence, confidenceThreshold),
      ),
    )
    .orderBy(sql`${memories.embedding} <=> ${vectorStr}::vector`)
    .limit(k);
}

// ---------------------------------------------------------------------------
// Memory proposals
// ---------------------------------------------------------------------------

/** Insert a new memory proposal for user review. */
export async function insertMemoryProposal(input: {
  readonly userId: UserId;
  readonly proposedText: string;
  readonly proposedKind: string;
  readonly sourceSessionId?: ChatSessionId;
}): Promise<MemoryProposalRow> {
  const rows = await db
    .insert(memoryProposals)
    .values({
      userId: input.userId,
      proposedText: input.proposedText,
      proposedKind: input.proposedKind,
      sourceSessionId: input.sourceSessionId ?? null,
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('insertMemoryProposal: no row returned');
  return row;
}

/**
 * List pending memory proposals for a user.
 * Ordered oldest-first so the earliest proposals are addressed first.
 */
export async function listPendingProposals(userId: UserId): Promise<MemoryProposalRow[]> {
  return db
    .select()
    .from(memoryProposals)
    .where(and(eq(memoryProposals.userId, userId), eq(memoryProposals.status, 'pending')))
    .orderBy(asc(memoryProposals.createdAt));
}

/**
 * Update a proposal's status to 'accepted' or 'rejected'.
 * Returns the updated row, or undefined if not found / wrong owner.
 */
export async function updateProposalStatus(
  id: MemoryProposalId,
  userId: UserId,
  status: 'accepted' | 'rejected',
): Promise<MemoryProposalRow | undefined> {
  const rows = await db
    .update(memoryProposals)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(memoryProposals.id, id), eq(memoryProposals.userId, userId)))
    .returning();
  return rows[0];
}

/**
 * Fetch a single proposal by ID. Returns undefined if not found.
 * Ownership is NOT enforced here — the caller must check userId.
 */
export async function getProposalById(id: MemoryProposalId): Promise<MemoryProposalRow | undefined> {
  const rows = await db
    .select()
    .from(memoryProposals)
    .where(eq(memoryProposals.id, id))
    .limit(1);
  return rows[0];
}

/**
 * Check whether a proposal with the given text has already been rejected for
 * this user. Used by the auto-extraction job to avoid re-proposing identical
 * content.
 *
 * Returns true if a rejected proposal with exactly this text exists.
 */
export async function hasRejectedProposalWithText(
  userId: UserId,
  text: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: memoryProposals.id })
    .from(memoryProposals)
    .where(
      and(
        eq(memoryProposals.userId, userId),
        eq(memoryProposals.proposedText, text),
        eq(memoryProposals.status, 'rejected'),
      ),
    )
    .limit(1);
  return rows.length > 0;
}
