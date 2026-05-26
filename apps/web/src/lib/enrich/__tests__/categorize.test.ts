import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

const { mockGenerateObject, mockLogLlmCall } = vi.hoisted(() => ({
  mockGenerateObject: vi.fn(),
  mockLogLlmCall: vi.fn(),
}));

vi.mock('ai', () => ({
  generateObject: mockGenerateObject,
}));

vi.mock('@ai-sdk/openai', () => ({
  openai: vi.fn(() => 'mocked-openai-model'),
}));

vi.mock('@/db/queries/llm-usage', () => ({
  logLlmCall: mockLogLlmCall,
}));

import {
  CATEGORY_TAXONOMY,
  applyCategorizationRules,
  callLlmCategorizeBatch,
  categorizeBatch,
} from '../categorize';
import type { CategorizationRuleRow } from '@/db/queries/categorization-rules';
import type { TransactionRow } from '@/db/queries/transactions';
import type { TransactionId, UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<CategorizationRuleRow>): CategorizationRuleRow {
  return {
    id: 'rule-uuid',
    userId: 'user-uuid',
    predicate: {},
    setCategory: 'Groceries',
    active: true,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeTxn(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 'txn-uuid',
    userId: 'user-uuid',
    accountId: 'acct-uuid',
    plaidTransactionId: 'plaid-id',
    postedAt: '2024-01-15',
    authorizedAt: null,
    amountCents: 5000n,
    currency: 'USD',
    merchantRaw: 'COSTCO WHOLESALE #1234',
    merchantNormalized: 'Costco',
    category: 'GENERAL_MERCHANDISE',
    categorySource: 'plaid',
    categoryConfidence: null,
    pending: false,
    source: 'plaid',
    confidence: 1.0,
    isTransfer: false,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CATEGORY_TAXONOMY
// ---------------------------------------------------------------------------

describe('CATEGORY_TAXONOMY', () => {
  it('contains ~25 categories', () => {
    expect(CATEGORY_TAXONOMY.length).toBeGreaterThanOrEqual(20);
    expect(CATEGORY_TAXONOMY.length).toBeLessThanOrEqual(30);
  });

  it('includes expected leaf categories', () => {
    expect(CATEGORY_TAXONOMY).toContain('Groceries');
    expect(CATEGORY_TAXONOMY).toContain('Restaurants & Bars');
    expect(CATEGORY_TAXONOMY).toContain('Streaming & Subscriptions');
    expect(CATEGORY_TAXONOMY).toContain('Other');
  });
});

// ---------------------------------------------------------------------------
// applyCategorizationRules
// ---------------------------------------------------------------------------

describe('applyCategorizationRules', () => {
  it('returns undefined when no rules provided', () => {
    expect(applyCategorizationRules(makeTxn(), [])).toBeUndefined();
  });

  it('matches merchant_contains (case-insensitive)', () => {
    const rules = [makeRule({ predicate: { merchant_contains: 'costco' }, setCategory: 'Groceries' })];
    const result = applyCategorizationRules(makeTxn({ merchantNormalized: 'Costco' }), rules);
    expect(result).toEqual({ category: 'Groceries', source: 'rule', confidence: 1.0 });
  });

  it('merchant_contains uses merchantNormalized when available', () => {
    const rules = [makeRule({ predicate: { merchant_contains: 'costco' } })];
    // merchantNormalized = 'Costco' should match, merchantRaw = 'COSTCO WHOLESALE #1234' would too but
    // the function prefers merchantNormalized.
    const txn = makeTxn({ merchantNormalized: 'Costco', merchantRaw: 'UNRELATED' });
    expect(applyCategorizationRules(txn, rules)).toBeDefined();
  });

  it('merchant_contains falls back to merchantRaw when normalized is null', () => {
    const rules = [makeRule({ predicate: { merchant_contains: 'spotify' }, setCategory: 'Streaming & Subscriptions' })];
    const txn = makeTxn({ merchantNormalized: null, merchantRaw: 'SPOTIFY AB' });
    expect(applyCategorizationRules(txn, rules)?.category).toBe('Streaming & Subscriptions');
  });

  it('matches merchant_exact (case-insensitive)', () => {
    const rules = [makeRule({ predicate: { merchant_exact: 'netflix' }, setCategory: 'Streaming & Subscriptions' })];
    const txn = makeTxn({ merchantNormalized: 'Netflix' });
    expect(applyCategorizationRules(txn, rules)?.category).toBe('Streaming & Subscriptions');
  });

  it('merchant_exact does not match partial', () => {
    const rules = [makeRule({ predicate: { merchant_exact: 'net' } })];
    expect(applyCategorizationRules(makeTxn({ merchantNormalized: 'Netflix' }), rules)).toBeUndefined();
  });

  it('matches category_is (case-insensitive)', () => {
    const rules = [makeRule({ predicate: { category_is: 'GENERAL_MERCHANDISE' }, setCategory: 'Shopping' })];
    const txn = makeTxn({ category: 'GENERAL_MERCHANDISE' });
    expect(applyCategorizationRules(txn, rules)?.category).toBe('Shopping');
  });

  it('category_is does not match different category', () => {
    const rules = [makeRule({ predicate: { category_is: 'FOOD_AND_DRINK' } })];
    const txn = makeTxn({ category: 'GENERAL_MERCHANDISE' });
    expect(applyCategorizationRules(txn, rules)).toBeUndefined();
  });

  it('matches amount_gte_cents when amount equals threshold', () => {
    const rules = [makeRule({ predicate: { amount_gte_cents: 5000 }, setCategory: 'Shopping' })];
    expect(applyCategorizationRules(makeTxn({ amountCents: 5000n }), rules)?.category).toBe('Shopping');
  });

  it('does not match amount_gte_cents when amount is below threshold', () => {
    const rules = [makeRule({ predicate: { amount_gte_cents: 10000 } })];
    expect(applyCategorizationRules(makeTxn({ amountCents: 5000n }), rules)).toBeUndefined();
  });

  it('matches amount_lte_cents', () => {
    const rules = [makeRule({ predicate: { amount_lte_cents: 5000 }, setCategory: 'Coffee & Tea' })];
    expect(applyCategorizationRules(makeTxn({ amountCents: 500n }), rules)?.category).toBe('Coffee & Tea');
  });

  it('all predicate conditions must match (AND logic)', () => {
    const rules = [
      makeRule({
        predicate: { merchant_contains: 'costco', amount_gte_cents: 20000 },
        setCategory: 'Groceries',
      }),
    ];
    // merchant matches but amount is below threshold — should not match
    const txn = makeTxn({ merchantNormalized: 'Costco', amountCents: 5000n });
    expect(applyCategorizationRules(txn, rules)).toBeUndefined();
  });

  it('first matching rule wins (priority order)', () => {
    const rules = [
      makeRule({ id: 'rule-1', predicate: { merchant_contains: 'costco' }, setCategory: 'Groceries', priority: 10 }),
      makeRule({ id: 'rule-2', predicate: { merchant_contains: 'costco' }, setCategory: 'Shopping', priority: 5 }),
    ];
    const result = applyCategorizationRules(makeTxn({ merchantNormalized: 'Costco' }), rules);
    expect(result?.category).toBe('Groceries');
  });

  it('returns confidence 1.0 for rule match', () => {
    const rules = [makeRule({ predicate: { merchant_contains: 'netflix' } })];
    const result = applyCategorizationRules(makeTxn({ merchantNormalized: 'Netflix' }), rules);
    expect(result?.confidence).toBe(1.0);
    expect(result?.source).toBe('rule');
  });
});

// ---------------------------------------------------------------------------
// callLlmCategorizeBatch
// ---------------------------------------------------------------------------

describe('callLlmCategorizeBatch', () => {
  const userId = 'user-uuid' as UserId;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogLlmCall.mockResolvedValue({});
  });

  it('returns empty map for empty input', async () => {
    const result = await callLlmCategorizeBatch([], userId);
    expect(result.size).toBe(0);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('returns categorized results from LLM', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        results: [{ id: 'txn-1', category: 'Groceries', confidence: 0.95 }],
      },
      usage: { inputTokens: 100, outputTokens: 20 },
    });

    const txns = [{ id: 'txn-1' as TransactionId, merchant: 'Costco', amountCents: 5000n, plaidCategory: null }];
    const result = await callLlmCategorizeBatch(txns, userId);

    expect(result.get('txn-1' as TransactionId)).toEqual({
      category: 'Groceries',
      source: 'ai',
      confidence: 0.95,
    });
  });

  it('remaps invalid taxonomy categories to "Other" with lowered confidence', async () => {
    mockGenerateObject.mockResolvedValue({
      object: {
        results: [{ id: 'txn-2', category: 'TOTALLY_INVALID_CAT', confidence: 0.9 }],
      },
      usage: { inputTokens: 50, outputTokens: 10 },
    });

    const txns = [{ id: 'txn-2' as TransactionId, merchant: 'Weird Co', amountCents: 1000n, plaidCategory: null }];
    const result = await callLlmCategorizeBatch(txns, userId);

    expect(result.get('txn-2' as TransactionId)).toEqual({
      category: 'Other',
      source: 'ai',
      confidence: 0.5,
    });
  });

  it('logs the LLM call', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { results: [{ id: 'txn-3', category: 'Shopping', confidence: 0.8 }] },
      usage: { inputTokens: 80, outputTokens: 15 },
    });

    await callLlmCategorizeBatch(
      [{ id: 'txn-3' as TransactionId, merchant: 'Amazon', amountCents: 3000n, plaidCategory: null }],
      userId,
    );

    expect(mockLogLlmCall).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini', inputTokens: 80, outputTokens: 15 }),
    );
  });
});

// ---------------------------------------------------------------------------
// categorizeBatch
// ---------------------------------------------------------------------------

describe('categorizeBatch', () => {
  const userId = 'user-uuid' as UserId;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogLlmCall.mockResolvedValue({});
  });

  it('returns empty map for empty input', async () => {
    const result = await categorizeBatch([], userId, []);
    expect(result.size).toBe(0);
    expect(mockGenerateObject).not.toHaveBeenCalled();
  });

  it('applies rule without calling LLM when rule matches', async () => {
    const txn = makeTxn({ id: 'txn-rule', merchantNormalized: 'Netflix' });
    const rules = [makeRule({ predicate: { merchant_contains: 'netflix' }, setCategory: 'Streaming & Subscriptions' })];

    const result = await categorizeBatch([txn], userId, rules);

    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(result.get('txn-rule' as TransactionId)).toEqual({
      category: 'Streaming & Subscriptions',
      source: 'rule',
      confidence: 1.0,
    });
  });

  it('falls back to LLM when no rule matches', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { results: [{ id: 'txn-llm', category: 'Groceries', confidence: 0.92 }] },
      usage: { inputTokens: 50, outputTokens: 10 },
    });

    const txn = makeTxn({ id: 'txn-llm', merchantNormalized: 'Costco' });
    const result = await categorizeBatch([txn], userId, []);

    expect(mockGenerateObject).toHaveBeenCalledOnce();
    expect(result.get('txn-llm' as TransactionId)).toEqual({
      category: 'Groceries',
      source: 'ai',
      confidence: 0.92,
    });
  });

  it('uses "Other" as fallback when LLM omits a result', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { results: [] },
      usage: { inputTokens: 10, outputTokens: 5 },
    });

    const txn = makeTxn({ id: 'txn-missing' });
    const result = await categorizeBatch([txn], userId, []);

    expect(result.get('txn-missing' as TransactionId)).toEqual({
      category: 'Other',
      source: 'ai',
      confidence: 0.3,
    });
  });

  it('mixes rule hits and LLM for different transactions', async () => {
    mockGenerateObject.mockResolvedValue({
      object: { results: [{ id: 'txn-b', category: 'Transportation', confidence: 0.88 }] },
      usage: { inputTokens: 40, outputTokens: 8 },
    });

    const txnA = makeTxn({ id: 'txn-a', merchantNormalized: 'Netflix' });
    const txnB = makeTxn({ id: 'txn-b', merchantNormalized: 'Uber' });
    const rules = [makeRule({ predicate: { merchant_contains: 'netflix' }, setCategory: 'Streaming & Subscriptions' })];

    const result = await categorizeBatch([txnA, txnB], userId, rules);

    expect(result.get('txn-a' as TransactionId)?.source).toBe('rule');
    expect(result.get('txn-b' as TransactionId)?.source).toBe('ai');
    // LLM should only be called for txnB.
    expect(mockGenerateObject).toHaveBeenCalledOnce();
  });
});
