import { count, desc, eq, sum } from 'drizzle-orm';
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
  // OpenAI — used for enrichment (Phase 4)
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
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

export type LlmUsageTotals = {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Summed estimated cost as a formatted decimal string (e.g. "0.012345"). */
  totalCostUsd: string;
};

/**
 * Single call site for logging every LLM call. Computes the cost estimate
 * and inserts into `llm_usage` in one step.
 *
 * Per AGENTS.md §6: every LLM call must log model, input tokens, output tokens,
 * latency, cost estimate, and tool calls via this helper.
 */
export async function logLlmCall(params: {
  readonly userId: UserId;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly latencyMs: number;
  readonly toolCalls?: readonly string[] | null;
}): Promise<LlmUsageRow> {
  return insertLlmUsage({
    userId: params.userId,
    model: params.model,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    latencyMs: params.latencyMs,
    toolCalls: params.toolCalls ? [...params.toolCalls] : null,
    estimatedCostUsd: estimateCostUsd(params.model, params.inputTokens, params.outputTokens),
  });
}

/**
 * Aggregate totals for the Settings cost surface. Returns 0-values when
 * the user has no usage rows yet.
 */
export async function getLlmUsageTotals(userId: UserId): Promise<LlmUsageTotals> {
  const rows = await db
    .select({
      totalCalls: count(),
      totalInputTokens: sum(llmUsage.inputTokens),
      totalOutputTokens: sum(llmUsage.outputTokens),
      totalCostUsd: sum(llmUsage.estimatedCostUsd),
    })
    .from(llmUsage)
    .where(eq(llmUsage.userId, userId));

  const row = rows[0];
  return {
    totalCalls: row?.totalCalls ?? 0,
    totalInputTokens: Number(row?.totalInputTokens ?? 0),
    totalOutputTokens: Number(row?.totalOutputTokens ?? 0),
    totalCostUsd: row?.totalCostUsd ?? '0.000000',
  };
}
