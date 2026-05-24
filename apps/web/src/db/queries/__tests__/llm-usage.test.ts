import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Drizzle mock — set up before vi.mock factories run.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const mockReturning = vi.fn();
  const mockValues = vi.fn(() => ({ returning: mockReturning }));
  const mockInsert = vi.fn(() => ({ values: mockValues }));
  const mockWhere = vi.fn();
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockReturning, mockValues, mockInsert, mockWhere, mockFrom, mockSelect };
});

vi.mock('@/lib/db', () => ({
  db: { insert: mocks.mockInsert, select: mocks.mockSelect },
}));

vi.mock('@/db/schema', () => ({
  llmUsage: {
    userId: 'user_id',
    inputTokens: 'input_tokens',
    outputTokens: 'output_tokens',
    estimatedCostUsd: 'estimated_cost_usd',
    createdAt: 'created_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
  desc: vi.fn((col: string) => `${col} DESC`),
  count: vi.fn(() => 'COUNT(*)'),
  sum: vi.fn((col: string) => `SUM(${col})`),
}));

import {
  estimateCostUsd,
  logLlmCall,
  getLlmUsageByUserId,
  getLlmUsageTotals,
} from '../llm-usage';
import type { UserId } from '@/shared/types';

const USER_ID = 'a17c2f90-1234-4d56-89ab-000000000001' as UserId;

const sampleRow = {
  id: 'usage-uuid',
  userId: USER_ID,
  model: 'claude-sonnet-4-5',
  inputTokens: 1000,
  outputTokens: 200,
  latencyMs: 800,
  toolCalls: null,
  estimatedCostUsd: '0.006000',
  createdAt: new Date(),
};

// ---------------------------------------------------------------------------
// estimateCostUsd
// ---------------------------------------------------------------------------
describe('estimateCostUsd', () => {
  it('calculates cost for claude-sonnet-4-5', () => {
    // 1000 input @ $3/M + 200 output @ $15/M = $0.003000 + $0.003000 = $0.006000
    expect(estimateCostUsd('claude-sonnet-4-5', 1000, 200)).toBe('0.006000');
  });

  it('calculates cost for claude-haiku-4-5', () => {
    // 1000 input @ $0.25/M + 200 output @ $1.25/M = $0.000250 + $0.000250 = $0.000500
    expect(estimateCostUsd('claude-haiku-4-5', 1000, 200)).toBe('0.000500');
  });

  it('falls back to default pricing for unknown model', () => {
    // Unknown model uses same default as claude-sonnet-4-5 ($3/$15 per M)
    expect(estimateCostUsd('unknown-model', 1000, 200)).toBe('0.006000');
  });

  it('returns 0.000000 for zero tokens', () => {
    expect(estimateCostUsd('claude-sonnet-4-5', 0, 0)).toBe('0.000000');
  });
});

// ---------------------------------------------------------------------------
// logLlmCall
// ---------------------------------------------------------------------------
describe('logLlmCall', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts a row with computed cost estimate', async () => {
    mocks.mockReturning.mockResolvedValue([sampleRow]);

    const result = await logLlmCall({
      userId: USER_ID,
      model: 'claude-sonnet-4-5',
      inputTokens: 1000,
      outputTokens: 200,
      latencyMs: 800,
      toolCalls: null,
    });

    expect(mocks.mockInsert).toHaveBeenCalledOnce();
    expect(mocks.mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        model: 'claude-sonnet-4-5',
        inputTokens: 1000,
        outputTokens: 200,
        latencyMs: 800,
        toolCalls: null,
        estimatedCostUsd: '0.006000',
      }),
    );
    expect(result).toEqual(sampleRow);
  });

  it('converts readonly toolCalls array to a plain array', async () => {
    mocks.mockReturning.mockResolvedValue([{ ...sampleRow, toolCalls: ['get_accounts'] }]);

    await logLlmCall({
      userId: USER_ID,
      model: 'claude-sonnet-4-5',
      inputTokens: 500,
      outputTokens: 100,
      latencyMs: 600,
      toolCalls: ['get_accounts'] as const,
    });

    expect(mocks.mockValues).toHaveBeenCalledWith(
      expect.objectContaining({ toolCalls: ['get_accounts'] }),
    );
  });

  it('throws when DB returns no row', async () => {
    mocks.mockReturning.mockResolvedValue([]);

    await expect(
      logLlmCall({
        userId: USER_ID,
        model: 'claude-sonnet-4-5',
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      }),
    ).rejects.toThrow('insertLlmUsage: no row returned');
  });
});

// ---------------------------------------------------------------------------
// getLlmUsageByUserId
// ---------------------------------------------------------------------------
describe('getLlmUsageByUserId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns rows ordered by createdAt desc', async () => {
    const mockOrderBy = vi.fn().mockResolvedValue([sampleRow]);
    mocks.mockWhere.mockReturnValue({ orderBy: mockOrderBy });

    const rows = await getLlmUsageByUserId(USER_ID);

    expect(mocks.mockSelect).toHaveBeenCalledOnce();
    expect(mocks.mockWhere).toHaveBeenCalledWith('user_id=a17c2f90-1234-4d56-89ab-000000000001');
    expect(mockOrderBy).toHaveBeenCalledWith('created_at DESC');
    expect(rows).toEqual([sampleRow]);
  });

  it('returns empty array when user has no usage', async () => {
    const mockOrderBy = vi.fn().mockResolvedValue([]);
    mocks.mockWhere.mockReturnValue({ orderBy: mockOrderBy });

    const rows = await getLlmUsageByUserId(USER_ID);
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getLlmUsageTotals
// ---------------------------------------------------------------------------
describe('getLlmUsageTotals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns aggregated totals when usage rows exist', async () => {
    mocks.mockWhere.mockResolvedValue([
      {
        totalCalls: 5,
        totalInputTokens: '10000',
        totalOutputTokens: '2000',
        totalCostUsd: '0.036000',
      },
    ]);

    const totals = await getLlmUsageTotals(USER_ID);

    expect(totals).toEqual({
      totalCalls: 5,
      totalInputTokens: 10000,
      totalOutputTokens: 2000,
      totalCostUsd: '0.036000',
    });
  });

  it('returns zero values when user has no usage', async () => {
    mocks.mockWhere.mockResolvedValue([
      {
        totalCalls: 0,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalCostUsd: null,
      },
    ]);

    const totals = await getLlmUsageTotals(USER_ID);

    expect(totals).toEqual({
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: '0.000000',
    });
  });

  it('returns zero values when query returns empty array', async () => {
    mocks.mockWhere.mockResolvedValue([]);

    const totals = await getLlmUsageTotals(USER_ID);

    expect(totals).toEqual({
      totalCalls: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: '0.000000',
    });
  });
});
