import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dependencies before importing the module under test
// ---------------------------------------------------------------------------

const { mockGetAllMerchantAliases, mockUpsertMerchantAlias, mockGenerateObject, mockLogLlmCall } = vi.hoisted(() => ({
  mockGetAllMerchantAliases: vi.fn(),
  mockUpsertMerchantAlias: vi.fn(),
  mockGenerateObject: vi.fn(),
  mockLogLlmCall: vi.fn(),
}));

vi.mock('@/db/queries/merchant-aliases', () => ({
  getAllMerchantAliases: mockGetAllMerchantAliases,
  upsertMerchantAlias: mockUpsertMerchantAlias,
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

import { applyAliasRules, normalizeMerchantBatch } from '../merchant-normalize';
import type { MerchantAliasRow } from '@/db/queries/merchant-aliases';
import type { UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAlias(overrides: Partial<MerchantAliasRow>): MerchantAliasRow {
  return {
    id: 'alias-uuid',
    rawPattern: 'starbucks',
    canonical: 'Starbucks',
    categoryHint: 'Food & Drink',
    priority: 0,
    createdBy: 'seed',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// applyAliasRules — deterministic matching
// ---------------------------------------------------------------------------

describe('applyAliasRules', () => {
  it('returns undefined when alias list is empty', () => {
    expect(applyAliasRules('STARBUCKS #1234', [])).toBeUndefined();
  });

  it('exact match (case-insensitive)', () => {
    const aliases = [makeAlias({ rawPattern: 'starbucks', canonical: 'Starbucks' })];
    const result = applyAliasRules('STARBUCKS', aliases);
    expect(result).toEqual({ canonical: 'Starbucks', source: 'rule', categoryHint: 'Food & Drink' });
  });

  it('exact match trims whitespace', () => {
    const aliases = [makeAlias({ rawPattern: 'starbucks', canonical: 'Starbucks' })];
    const result = applyAliasRules('  starbucks  ', aliases);
    expect(result).toEqual(expect.objectContaining({ canonical: 'Starbucks' }));
  });

  it('regex match', () => {
    const aliases = [makeAlias({ rawPattern: '/^amzn digital.*/', canonical: 'Amazon Prime' })];
    const result = applyAliasRules('AMZN DIGITAL SVCS', aliases);
    expect(result).toEqual({ canonical: 'Amazon Prime', source: 'rule', categoryHint: 'Food & Drink' });
  });

  it('regex match is case-insensitive', () => {
    const aliases = [makeAlias({ rawPattern: '/^netflix.*/', canonical: 'Netflix' })];
    const result = applyAliasRules('NETFLIX.COM', aliases);
    expect(result).toEqual(expect.objectContaining({ canonical: 'Netflix' }));
  });

  it('returns undefined when no alias matches', () => {
    const aliases = [makeAlias({ rawPattern: 'starbucks', canonical: 'Starbucks' })];
    const result = applyAliasRules('COSTCO WHOLESALE', aliases);
    expect(result).toBeUndefined();
  });

  it('higher priority alias wins when multiple match', () => {
    const aliases = [
      makeAlias({ rawPattern: 'amazon', canonical: 'Amazon', priority: 10 }),
      makeAlias({ id: 'alias-2', rawPattern: '/^amazon.*/', canonical: 'Amazon Shopping', priority: 5 }),
    ];
    // Aliases must already be sorted by priority desc (as returned from DB).
    const result = applyAliasRules('amazon', aliases);
    expect(result?.canonical).toBe('Amazon');
  });

  it('skips malformed regex without throwing', () => {
    const aliases = [
      makeAlias({ rawPattern: '/[invalid(/', canonical: 'Bad Regex' }),
      makeAlias({ id: 'alias-2', rawPattern: 'starbucks', canonical: 'Starbucks' }),
    ];
    const result = applyAliasRules('starbucks', aliases);
    expect(result?.canonical).toBe('Starbucks');
  });

  it('returns null categoryHint when alias has no hint', () => {
    const aliases = [makeAlias({ rawPattern: 'test merchant', canonical: 'Test', categoryHint: null })];
    const result = applyAliasRules('test merchant', aliases);
    expect(result?.categoryHint).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// normalizeMerchantBatch
// ---------------------------------------------------------------------------

describe('normalizeMerchantBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertMerchantAlias.mockResolvedValue({});
    mockLogLlmCall.mockResolvedValue({});
  });

  it('returns empty map for empty input', async () => {
    const result = await normalizeMerchantBatch([], 'user-uuid' as UserId);
    expect(result.size).toBe(0);
    expect(mockGetAllMerchantAliases).not.toHaveBeenCalled();
  });

  it('resolves via deterministic rule without calling LLM', async () => {
    mockGetAllMerchantAliases.mockResolvedValue([
      makeAlias({ rawPattern: 'starbucks', canonical: 'Starbucks' }),
    ]);

    const result = await normalizeMerchantBatch(['STARBUCKS'], 'user-uuid' as UserId);

    expect(mockGenerateObject).not.toHaveBeenCalled();
    expect(result.get('STARBUCKS')).toEqual({
      canonical: 'Starbucks',
      source: 'rule',
      categoryHint: 'Food & Drink',
    });
  });

  it('calls LLM for unknown merchants and caches result', async () => {
    mockGetAllMerchantAliases.mockResolvedValue([]);
    mockGenerateObject.mockResolvedValue({
      object: {
        results: [
          { raw: 'COSTCO WHOLESALE #1234', canonical: 'Costco', categoryHint: 'Groceries' },
        ],
      },
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const result = await normalizeMerchantBatch(['COSTCO WHOLESALE #1234'], 'user-uuid' as UserId);

    expect(mockGenerateObject).toHaveBeenCalledOnce();
    expect(result.get('COSTCO WHOLESALE #1234')).toEqual({
      canonical: 'Costco',
      source: 'ai',
      categoryHint: 'Groceries',
    });
    // AI result must be persisted.
    expect(mockUpsertMerchantAlias).toHaveBeenCalledWith(
      expect.objectContaining({ canonical: 'Costco', createdBy: 'ai' }),
    );
  });

  it('deduplicates identical raw merchants before LLM call', async () => {
    mockGetAllMerchantAliases.mockResolvedValue([]);
    mockGenerateObject.mockResolvedValue({
      object: {
        results: [{ raw: 'walmart', canonical: 'Walmart', categoryHint: 'Shopping' }],
      },
      usage: { inputTokens: 20, outputTokens: 10 },
    });

    await normalizeMerchantBatch(['walmart', 'walmart', 'walmart'], 'user-uuid' as UserId);

    expect(mockGenerateObject).toHaveBeenCalledOnce();
  });

  it('falls back to raw merchant when LLM omits a result', async () => {
    mockGetAllMerchantAliases.mockResolvedValue([]);
    // LLM returns no results (empty array).
    mockGenerateObject.mockResolvedValue({ object: { results: [] }, usage: { inputTokens: 10, outputTokens: 5 } });

    const result = await normalizeMerchantBatch(['WEIRD MERCHANT XYZ'], 'user-uuid' as UserId);

    expect(result.get('WEIRD MERCHANT XYZ')).toEqual({
      canonical: 'WEIRD MERCHANT XYZ',
      source: 'ai',
      categoryHint: null,
    });
  });

  it('mixes rule hits and LLM for different merchants', async () => {
    mockGetAllMerchantAliases.mockResolvedValue([
      makeAlias({ rawPattern: 'netflix.com', canonical: 'Netflix', categoryHint: 'Subscriptions' }),
    ]);
    mockGenerateObject.mockResolvedValue({
      object: {
        results: [{ raw: 'HULU SVCS', canonical: 'Hulu', categoryHint: 'Subscriptions' }],
      },
      usage: { inputTokens: 30, outputTokens: 15 },
    });

    const result = await normalizeMerchantBatch(['NETFLIX.COM', 'HULU SVCS'], 'user-uuid' as UserId);

    expect(result.get('NETFLIX.COM')).toEqual(
      expect.objectContaining({ canonical: 'Netflix', source: 'rule' }),
    );
    expect(result.get('HULU SVCS')).toEqual(
      expect.objectContaining({ canonical: 'Hulu', source: 'ai' }),
    );
    expect(mockGenerateObject).toHaveBeenCalledOnce();
  });
});
