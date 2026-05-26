import { z } from 'zod';
import { deleteMemory as aiDeleteMemory } from '@/ai/memory';
import { brand } from '@/shared/types';
import type { MemoryId } from '@/shared/types';
import type { ToolContext } from './context';

export const inputSchema = z.object({
  /** ID of the memory to delete. */
  id: z.string().min(1),
});

export const outputSchema = z.object({
  memoryId: z.string(),
  deleted: z.literal(true),
});

export type DeleteMemoryOutput = z.infer<typeof outputSchema>;

/**
 * Hard-delete a memory on behalf of the user.
 *
 * Only the owning user's memories can be deleted. "Forget that" must actually
 * remove data — there is no soft-delete for memories.
 */
export async function handler(
  input: z.infer<typeof inputSchema>,
  ctx: ToolContext,
): Promise<DeleteMemoryOutput> {
  await aiDeleteMemory(ctx.userId, brand<MemoryId>(input.id));
  return { memoryId: input.id, deleted: true };
}
