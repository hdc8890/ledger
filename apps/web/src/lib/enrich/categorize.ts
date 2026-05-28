/**
 * Category Inference Service — Phase 4 Task 2
 *
 * Assigns a category to each transaction via a two-tier approach:
 *   1. Deterministic rules from `categorization_rules` (predicate-matched, priority-ordered).
 *   2. LLM fallback via gpt-4o-mini for transactions that no rule covers.
 *
 * Idempotency: the caller only passes transactions with categorySource IS NULL or 'plaid'.
 * This service never overwrites categorySource IN ('user', 'rule', 'ai').
 */

import { generateObject } from 'ai';
import { getEnrichmentModel } from '@/ai/provider';
import { z } from 'zod';
import { logLlmCall } from '@/db/queries/llm-usage';
import type { CategorizationRuleRow } from '@/db/queries/categorization-rules';
import type { TransactionRow } from '@/db/queries/transactions';
import type { TransactionId, UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

/**
 * Simplified ~25-leaf category taxonomy. Derived from Plaid PFC hierarchy but
 * mapped to how a household actually thinks about spending.
 */
export const CATEGORY_TAXONOMY = [
  'Groceries',
  'Restaurants & Bars',
  'Coffee & Tea',
  'Fast Food',
  'Shopping',
  'Entertainment',
  'Streaming & Subscriptions',
  'Travel',
  'Transportation',
  'Gas',
  'Healthcare',
  'Personal Care',
  'Fitness',
  'Education',
  'Home & Garden',
  'Electronics',
  'Utilities',
  'Insurance',
  'Rent & Housing',
  'Financial Services & Fees',
  'Investments',
  'Income',
  'Gifts & Donations',
  'Pets',
  'Other',
] as const satisfies readonly string[];

export type Category = (typeof CATEGORY_TAXONOMY)[number];

// ---------------------------------------------------------------------------
// Predicate types
// ---------------------------------------------------------------------------

/**
 * Conditions stored in categorization_rules.predicate (jsonb).
 * All provided fields are ANDed together. At least one must be set.
 */
export type CategorizationPredicate = {
  readonly merchant_contains?: string;
  readonly merchant_exact?: string;
  readonly category_is?: string;
  readonly amount_gte_cents?: number;
  readonly amount_lte_cents?: number;
};

export type CategorizedResult = {
  readonly category: string;
  readonly source: 'rule' | 'ai';
  readonly confidence: number;
};

// ---------------------------------------------------------------------------
// Deterministic rule matching
// ---------------------------------------------------------------------------

/**
 * Evaluate a single predicate against a transaction.
 * All present conditions must match (AND semantics).
 */
function matchesPredicate(
  txn: Pick<TransactionRow, 'merchantRaw' | 'merchantNormalized' | 'amountCents' | 'category'>,
  predicate: CategorizationPredicate,
): boolean {
  const merchant = (txn.merchantNormalized ?? txn.merchantRaw).toLowerCase();

  if (
    predicate.merchant_contains !== undefined &&
    !merchant.includes(predicate.merchant_contains.toLowerCase())
  ) {
    return false;
  }

  if (
    predicate.merchant_exact !== undefined &&
    merchant !== predicate.merchant_exact.toLowerCase()
  ) {
    return false;
  }

  if (
    predicate.category_is !== undefined &&
    (txn.category ?? '').toLowerCase() !== predicate.category_is.toLowerCase()
  ) {
    return false;
  }

  if (
    predicate.amount_gte_cents !== undefined &&
    txn.amountCents < BigInt(predicate.amount_gte_cents)
  ) {
    return false;
  }

  if (
    predicate.amount_lte_cents !== undefined &&
    txn.amountCents > BigInt(predicate.amount_lte_cents)
  ) {
    return false;
  }

  return true;
}

/**
 * Apply categorization rules to a transaction.
 * Rules must be sorted by priority descending (highest priority first).
 * Returns the first matching rule's category, or undefined if no rule matches.
 */
export function applyCategorizationRules(
  txn: Pick<TransactionRow, 'merchantRaw' | 'merchantNormalized' | 'amountCents' | 'category'>,
  rules: readonly CategorizationRuleRow[],
): CategorizedResult | undefined {
  for (const rule of rules) {
    const predicate = rule.predicate as CategorizationPredicate;
    if (matchesPredicate(txn, predicate)) {
      return { category: rule.setCategory, source: 'rule', confidence: 1.0 };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// LLM fallback
// ---------------------------------------------------------------------------

const llmCategorizeBatchResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      category: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

type TxnForLlm = {
  readonly id: TransactionId;
  readonly merchant: string;
  readonly amountCents: bigint;
  readonly plaidCategory: string | null;
};

/**
 * Call gpt-4o-mini to categorize a batch of transactions.
 * Each item includes a stable id so results can be mapped back regardless of order.
 * Batch size must be ≤50.
 * Logs the LLM call to llm_usage (AGENTS.md §6).
 */
export async function callLlmCategorizeBatch(
  txns: readonly TxnForLlm[],
  userId: UserId,
): Promise<Map<TransactionId, CategorizedResult>> {
  if (txns.length === 0) return new Map();

  const startMs = Date.now();
  const { object, usage } = await generateObject({
    model: getEnrichmentModel(),
    schema: llmCategorizeBatchResponseSchema,
    prompt: [
      'You are a financial transaction categorization assistant.',
      `Assign each transaction to exactly one category from this list:`,
      CATEGORY_TAXONOMY.join(', '),
      '',
      'For each transaction return:',
      '  - "id": the transaction id provided',
      '  - "category": one of the categories above (exact string match)',
      '  - "confidence": 0.0–1.0 confidence score',
      '',
      'Transactions:',
      txns
        .map(
          (t, i) =>
            `${i + 1}. id="${t.id}" merchant="${t.merchant}" amount=${(Number(t.amountCents) / 100).toFixed(2)} plaid_category="${t.plaidCategory ?? 'unknown'}"`,
        )
        .join('\n'),
    ].join('\n'),
  });

  void logLlmCall({
    userId,
    model: 'gpt-4o-mini',
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    latencyMs: Date.now() - startMs,
    toolCalls: null,
  }).catch(() => {});

  const result = new Map<TransactionId, CategorizedResult>();
  for (const item of object.results) {
    const isValidCategory = (CATEGORY_TAXONOMY as readonly string[]).includes(item.category);
    result.set(item.id as TransactionId, {
      category: isValidCategory ? item.category : 'Other',
      source: 'ai',
      confidence: isValidCategory ? item.confidence : 0.5,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main categorization function
// ---------------------------------------------------------------------------

/**
 * Categorize a batch of transactions.
 *
 * Algorithm:
 *   1. For each transaction, try deterministic rule matching (applyCategorizationRules).
 *   2. Collect transactions with no rule match.
 *   3. If any unknowns remain, call gpt-4o-mini in a single batch (≤50).
 *   4. Return a map of TransactionId → CategorizedResult for all inputs.
 *
 * Rules must be pre-sorted by priority descending.
 * Batch size is capped at 50 by the caller (Inngest step).
 */
export async function categorizeBatch(
  txns: readonly TransactionRow[],
  userId: UserId,
  rules: readonly CategorizationRuleRow[],
): Promise<Map<TransactionId, CategorizedResult>> {
  if (txns.length === 0) return new Map();

  const result = new Map<TransactionId, CategorizedResult>();
  const needsLlm: TxnForLlm[] = [];

  for (const txn of txns) {
    const ruleResult = applyCategorizationRules(txn, rules);
    if (ruleResult !== undefined) {
      result.set(txn.id as TransactionId, ruleResult);
    } else {
      needsLlm.push({
        id: txn.id as TransactionId,
        merchant: txn.merchantNormalized ?? txn.merchantRaw,
        amountCents: txn.amountCents,
        plaidCategory: txn.category,
      });
    }
  }

  if (needsLlm.length > 0) {
    const llmResults = await callLlmCategorizeBatch(needsLlm, userId);
    for (const [id, categorized] of llmResults) {
      result.set(id, categorized);
    }

    // For any LLM non-responses, fall back to 'Other'.
    for (const txn of needsLlm) {
      if (!result.has(txn.id)) {
        result.set(txn.id, { category: 'Other', source: 'ai', confidence: 0.3 });
      }
    }
  }

  return result;
}
