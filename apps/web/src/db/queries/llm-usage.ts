import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { llmUsage } from '@/db/schema';
import type { LlmUsageId, UserId } from '@/shared/types';

export type LlmUsageRow = typeof llmUsage.$inferSelect;
export type NewLlmUsage = typeof llmUsage.$inferInsert;

// Token pricing for cost estimation (USD per million tokens).
// Updated: Anthropic Claude Sonnet 4 pricing (2025).
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.25, output: 1.25 },
};
const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): string {
  const pricing = PRICING[model] ?? DEFAULT_PRICING;
  const cost = (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
  return cost.toFixed(6);
}

/**
 * Persist a single LLM call log. Called by the chat route's onFinish callback.
 */
export async function insertLlmUsage(input: NewLlmUsage): Promise<LlmUsageRow> {
  const rows = await db.insert(llmUsage).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('insertLlmUsage: no row returned');
  return row;
}

/**
 * Fetch usage rows for a user (used in Settings cost view — Phase 3 Task 7).
 */
export async function getLlmUsageByUserId(userId: UserId): Promise<LlmUsageRow[]> {
  return db
    .select()
    .from(llmUsage)
    .where(eq(llmUsage.userId, userId))
    .orderBy(desc(llmUsage.createdAt));
}

export type { LlmUsageId };
