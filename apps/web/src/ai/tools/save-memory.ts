import { z } from 'zod';
import { saveMemory as aiSaveMemory } from '@/ai/memory';
import type { ToolContext } from './context';

/** Valid memory kinds — mirrors the DB enum. */
export const memoryKindSchema = z.enum([
  'preference',
  'household_rule',
  'historical_context',
  'goal',
  'override_note',
]);

export const inputSchema = z.object({
  /** Semantic text of the memory. Must not contain raw dollar amounts, account numbers, or institution names. */
  text: z.string().min(1).max(1000),
  /** Classification of the memory. */
  kind: memoryKindSchema,
  /** Optional structured metadata (e.g. source transaction id). */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const outputSchema = z.object({
  memoryId: z.string(),
  text: z.string(),
  kind: memoryKindSchema,
});

export type SaveMemoryOutput = z.infer<typeof outputSchema>;

/**
 * Persist a new memory for the user.
 *
 * Unlike other write tools, this commits directly — no pending_changes proposal.
 * Per phase plan: memory approval is handled through the Memory UI, not the
 * approval-card flow used for transaction/asset changes.
 *
 * Privacy rule: `text` must be semantic — the caller (the LLM) must not include
 * raw amounts, account numbers, or institution names. The description instructs
 * the model on this constraint.
 */
export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<SaveMemoryOutput> {
  const memory = await aiSaveMemory(
    ctx.userId,
    input.kind,
    input.text,
    input.metadata,
  );
  return {
    memoryId: memory.id,
    text: memory.text,
    kind: input.kind,
  };
}
