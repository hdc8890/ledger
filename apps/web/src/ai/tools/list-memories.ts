import { z } from 'zod';
import { listMemories as aiListMemories } from '@/ai/memory';
import { memoryKindSchema } from './save-memory';
import type { ToolContext } from './context';

export const inputSchema = z.object({
  /** Filter by memory kind. Omit to return all kinds. */
  kind: memoryKindSchema.optional(),
  /** Maximum number of memories to return (1–50). */
  limit: z.number().int().min(1).max(50).default(20),
  /** Pagination offset. */
  offset: z.number().int().min(0).default(0),
});

export const outputSchema = z.object({
  memories: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      kind: memoryKindSchema,
      confidence: z.number(),
      createdAt: z.string(), // ISO-8601
    }),
  ),
  count: z.number(),
});

export type ListMemoriesOutput = z.infer<typeof outputSchema>;

/**
 * Return a paginated list of the user's memories.
 * Embeddings are excluded from the response — they are irrelevant to the agent.
 */
export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<ListMemoriesOutput> {
  const rows = await aiListMemories(ctx.userId, input.kind, input.limit, input.offset);
  return {
    memories: rows.map((m) => ({
      id: m.id,
      text: m.text,
      kind: m.kind,
      confidence: m.confidence,
      createdAt: m.createdAt.toISOString(),
    })),
    count: rows.length,
  };
}
