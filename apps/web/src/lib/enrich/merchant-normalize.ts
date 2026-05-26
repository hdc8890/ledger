/**
 * Merchant Normalization Service — Phase 4 Task 1
 *
 * Resolves a raw merchant string to a canonical name using a two-tier approach:
 *   1. Deterministic lookup against merchant_aliases (exact, then regex, highest priority first)
 *   2. LLM fallback via gpt-4o-mini for unknowns; results cached back to merchant_aliases
 *
 * The LLM is batched (≤50 per call) and only called for genuinely unknown merchants.
 * AI-inferred results are persisted with created_by='ai' so repeat calls are skipped.
 */

import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import {
  getAllMerchantAliases,
  upsertMerchantAlias,
  type MerchantAliasRow,
} from '@/db/queries/merchant-aliases';
import { logLlmCall } from '@/db/queries/llm-usage';
import type { UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NormalizedMerchant = {
  readonly canonical: string;
  /** Source of the canonical name. */
  readonly source: 'rule' | 'ai';
  /** Category hint from the alias row, if any. */
  readonly categoryHint: string | null;
};

// ---------------------------------------------------------------------------
// Deterministic lookup
// ---------------------------------------------------------------------------

/**
 * Normalise a raw merchant string using an in-memory alias list.
 * Checks exact match first, then regex (pattern wrapped in /…/ slashes).
 * The alias list must be pre-sorted highest priority first.
 */
export function applyAliasRules(
  raw: string,
  aliases: readonly MerchantAliasRow[],
): NormalizedMerchant | undefined {
  const normalizedRaw = raw.trim().toLowerCase();

  for (const alias of aliases) {
    const pattern = alias.rawPattern;

    if (pattern.startsWith('/') && pattern.endsWith('/') && pattern.length > 2) {
      // Regex pattern: strip surrounding slashes and compile.
      const regexSource = pattern.slice(1, -1);
      let re: RegExp;
      try {
        re = new RegExp(regexSource, 'i');
      } catch {
        // Skip malformed regex patterns rather than crashing.
        continue;
      }
      if (re.test(normalizedRaw)) {
        return { canonical: alias.canonical, source: 'rule', categoryHint: alias.categoryHint ?? null };
      }
    } else {
      // Exact (case-insensitive) match.
      if (pattern.toLowerCase() === normalizedRaw) {
        return { canonical: alias.canonical, source: 'rule', categoryHint: alias.categoryHint ?? null };
      }
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// LLM fallback
// ---------------------------------------------------------------------------

const llmBatchResponseSchema = z.object({
  results: z.array(
    z.object({
      raw: z.string(),
      canonical: z.string(),
      categoryHint: z.string().nullable(),
    }),
  ),
});

/**
 * Call gpt-4o-mini to normalise a batch of unknown merchant strings.
 * Returns a map of raw → { canonical, categoryHint }.
 * Batch size must be ≤50 to stay within token budgets.
 * Logs the LLM call to llm_usage via logLlmCall (AGENTS.md §6).
 */
export async function callLlmBatch(
  unknownMerchants: readonly string[],
  userId: UserId,
): Promise<Map<string, { canonical: string; categoryHint: string | null }>> {
  if (unknownMerchants.length === 0) return new Map();

  const startMs = Date.now();
  const { object, usage } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: llmBatchResponseSchema,
    prompt: [
      'You are a financial data enrichment assistant.',
      'For each raw merchant string below, return:',
      '  - "canonical": the clean, human-readable merchant name (e.g. "Starbucks", "Amazon Prime", "Netflix")',
      '  - "categoryHint": a single spending category from this list, or null if unsure:',
      '    Food & Drink, Groceries, Shopping, Entertainment, Subscriptions, Travel,',
      '    Transportation, Healthcare, Utilities, Gas, Personal Care, Education,',
      '    Financial Services, Restaurants, Home, Other',
      '',
      'Raw merchants:',
      unknownMerchants.map((m, i) => `${i + 1}. "${m}"`).join('\n'),
    ].join('\n'),
  });

  // Log the LLM call for cost monitoring (AGENTS.md §6). Fire-and-forget —
  // a logging failure must not abort enrichment.
  void logLlmCall({
    userId,
    model: 'gpt-4o-mini',
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    latencyMs: Date.now() - startMs,
    toolCalls: null,
  }).catch(() => {});

  const result = new Map<string, { canonical: string; categoryHint: string | null }>();
  for (const item of object.results) {
    result.set(item.raw, { canonical: item.canonical, categoryHint: item.categoryHint });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main normalisation function
// ---------------------------------------------------------------------------

/**
 * Normalise a batch of raw merchant strings.
 *
 * Algorithm:
 *   1. Load all merchant_aliases (once per call) — these are sorted by priority desc.
 *   2. For each raw string, try deterministic lookup (applyAliasRules).
 *   3. Collect unknowns; if any, call gpt-4o-mini in a single batch (≤50).
 *   4. Persist AI results to merchant_aliases with created_by='ai'.
 *   5. Return a map of raw → NormalizedMerchant for all inputs.
 *
 * Idempotent: if every input already has an alias, no LLM call is made.
 * Batch size is capped at 50 by the caller (Inngest step).
 */
export async function normalizeMerchantBatch(
  rawMerchants: readonly string[],
  userId: UserId,
): Promise<Map<string, NormalizedMerchant>> {
  if (rawMerchants.length === 0) return new Map();

  // Deduplicate inputs to avoid redundant lookups.
  const unique = [...new Set(rawMerchants)];

  const aliases = await getAllMerchantAliases();

  const result = new Map<string, NormalizedMerchant>();
  const unknowns: string[] = [];

  for (const raw of unique) {
    const match = applyAliasRules(raw, aliases);
    if (match !== undefined) {
      result.set(raw, match);
    } else {
      unknowns.push(raw);
    }
  }

  if (unknowns.length > 0) {
    const llmResults = await callLlmBatch(unknowns, userId);

    // Persist AI results and populate the output map.
    for (const raw of unknowns) {
      const llm = llmResults.get(raw);
      if (llm !== undefined) {
        // Cache to DB — upsert handles race conditions.
        await upsertMerchantAlias({
          rawPattern: raw.trim().toLowerCase(),
          canonical: llm.canonical,
          categoryHint: llm.categoryHint ?? undefined,
          priority: 0,
          createdBy: 'ai',
        });
        result.set(raw, { canonical: llm.canonical, source: 'ai', categoryHint: llm.categoryHint });
      } else {
        // LLM didn't return a result for this raw string — fall back to raw.
        result.set(raw, { canonical: raw, source: 'ai', categoryHint: null });
      }
    }
  }

  return result;
}
