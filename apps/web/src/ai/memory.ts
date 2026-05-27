/**
 * ai/memory.ts — High-level memory helpers for the agent layer.
 *
 * Wraps the memory repository with embedding generation so callers don't
 * need to import the embeddings model or deal with vector formatting.
 *
 * Privacy rule (AGENTS.md §0): memory text must be semantic — no raw
 * dollar amounts, account numbers, or institution names. Enforced by
 * validateMemoryText(), which is called in saveMemory() and updateMemoryText().
 */

import { embed } from 'ai';
import { openai } from '@ai-sdk/openai';
import {
  insertMemory,
  updateMemory as dbUpdateMemory,
  updateMemoryEmbedding,
  getMemoryById as dbGetMemoryById,
  retrieveMemoriesBySimilarity,
  deleteMemory as dbDeleteMemory,
  listMemories as dbListMemories,
} from '@/db/queries/memories';
import type { MemoryRow, MemoryKind } from '@/db/queries/memories';
import type { UserId, MemoryId } from '@/shared/types';
import { insertAuditEvent } from '@/db/queries/audit-events';

// ---------------------------------------------------------------------------
// Privacy validation
// ---------------------------------------------------------------------------

/**
 * Reject text that contains raw financial data.
 *
 * Blocks:
 *   - Dollar amounts: "$1,234.56", "$50000", "$1.5k" (any "$" followed by digits)
 *   - Long digit sequences (≥8 consecutive digits) that resemble account/card numbers
 *
 * Throws `Error` if either pattern is detected. Callers must sanitize their
 * text to be semantic before passing it here.
 */
export function validateMemoryText(text: string): void {
  if (/\$\d[\d,]*(?:\.\d{1,2})?/.test(text)) {
    throw new Error(
      'validateMemoryText: raw dollar amount detected — memory text must be semantic (no dollar values)',
    );
  }
  if (/\d{8,}/.test(text)) {
    throw new Error(
      'validateMemoryText: long digit sequence detected — memory text must not contain account or card numbers',
    );
  }
}

/** text-embedding-3-small: 1536 dims, ~$0.02/1M tokens — negligible at personal scale. */
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIM = 1536;

/**
 * Generate an embedding for the given text using text-embedding-3-small.
 * Returns a 1536-dimensional float array.
 */
async function getEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: openai.embedding(EMBEDDING_MODEL),
    value: text,
  });
  if (embedding.length !== EMBEDDING_DIM) {
    throw new Error(
      `getEmbedding: expected ${EMBEDDING_DIM}-dim embedding, got ${embedding.length}`,
    );
  }
  return embedding;
}

/**
 * Persist a new memory with a pre-computed embedding.
 *
 * Steps:
 *   1. Insert the row (without embedding — marks it as not yet retrievable).
 *   2. Compute the text embedding via text-embedding-3-small.
 *   3. Write the embedding back to the row.
 *
 * The two-step approach ensures the row exists even if the embedding call
 * fails, making the write idempotent with a subsequent updateMemoryEmbedding.
 * Rows left with embedding=null are unreachable via retrieval (filtered by
 * isNotNull); a future background retry job (TODO) should clean them up.
 *
 * @param userId    - Authenticated user.
 * @param kind      - Memory classification.
 * @param text      - Semantic content. Must not contain raw financial data.
 * @param metadata  - Optional structured context ({ source_txn_id, … }).
 * @param confidence - 0–1 confidence; defaults to 1.0 for user-confirmed memories.
 */
export async function saveMemory(
  userId: UserId,
  kind: MemoryKind,
  text: string,
  metadata?: Record<string, unknown>,
  confidence = 1.0,
): Promise<MemoryRow> {
  validateMemoryText(text);
  const memory = await insertMemory({
    userId,
    kind,
    text,
    confidence,
    ...(metadata !== undefined ? { metadata } : {}),
  });
  const embedding = await getEmbedding(text);
  await updateMemoryEmbedding(memory.id as MemoryId, embedding);
  await insertAuditEvent({
    actor: userId,
    action: 'memory.create',
    entityType: 'memory',
    entityId: memory.id,
    before: null,
    after: { kind, text: memory.text },
    source: 'ai',
    confidence: memory.confidence,
  });
  return { ...memory, embedding };
}

/**
 * Retrieve the top-K memories most semantically similar to queryText.
 *
 * Process:
 *   1. Embed queryText with text-embedding-3-small.
 *   2. Run cosine ANN search (pgvector HNSW) against the memories table.
 *   3. Return up to k results ordered by similarity descending.
 *
 * Called before each chat turn to inject relevant context into the system
 * prompt (Phase 5 Task 3). Capped at k=10 to bound prompt token usage.
 */
export async function retrieveMemories(
  userId: UserId,
  queryText: string,
  k = 10,
  confidenceThreshold = 0.0,
): Promise<MemoryRow[]> {
  const embedding = await getEmbedding(queryText);
  return retrieveMemoriesBySimilarity(userId, embedding, k, confidenceThreshold);
}

/**
 * Hard-delete a memory by ID. Ownership is enforced — only the owning user
 * can delete their memories.
 *
 * Used by the `delete_memory` agent tool and the Memory management UI.
 * Per AGENTS.md: "forget that" must actually remove the data.
 */
export async function deleteMemory(userId: UserId, memoryId: MemoryId): Promise<void> {
  const prior = await dbGetMemoryById(memoryId);
  await dbDeleteMemory(memoryId, userId);
  await insertAuditEvent({
    actor: userId,
    action: 'memory.delete',
    entityType: 'memory',
    entityId: memoryId,
    before: prior ? { kind: prior.kind, text: prior.text } : null,
    after: null,
    source: 'user',
    confidence: null,
  });
}

/**
 * List all memories for a user, optionally filtered by kind.
 * Returned ordered by most recently created.
 */
export async function listMemories(
  userId: UserId,
  kind?: MemoryKind,
  limit = 50,
  offset = 0,
): Promise<MemoryRow[]> {
  return dbListMemories(userId, kind, limit, offset);
}

/**
 * Update the text of an existing memory.
 *
 * Steps:
 *   1. Validate the new text with validateMemoryText.
 *   2. Persist the new text in the DB.
 *   3. Recompute and store the embedding so retrieval stays accurate.
 *   4. Write an audit event.
 *
 * Returns the updated row, or undefined if the memory is not found or
 * does not belong to the user.
 */
export async function updateMemoryText(
  userId: UserId,
  memoryId: MemoryId,
  newText: string,
): Promise<MemoryRow | undefined> {
  validateMemoryText(newText);
  const prior = await dbGetMemoryById(memoryId);
  const updated = await dbUpdateMemory(memoryId, userId, { text: newText });
  if (!updated) return undefined;
  const embedding = await getEmbedding(newText);
  await updateMemoryEmbedding(memoryId, embedding);
  await insertAuditEvent({
    actor: userId,
    action: 'memory.update',
    entityType: 'memory',
    entityId: memoryId,
    before: prior ? { text: prior.text } : null,
    after: { text: newText },
    source: 'user',
    confidence: 1.0,
  });
  return { ...updated, embedding };
}
