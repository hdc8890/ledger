import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Drizzle/DB mock — must be set up before vi.mock factories run.
// ---------------------------------------------------------------------------
const mocks = vi.hoisted(() => {
  const mockExecute = vi.fn();
  const mockWhere = vi.fn();
  const mockFrom = vi.fn(() => ({ where: mockWhere }));
  const mockSelect = vi.fn(() => ({ from: mockFrom }));
  return { mockExecute, mockWhere, mockFrom, mockSelect };
});

vi.mock('@/lib/db', () => ({
  db: { execute: mocks.mockExecute, select: mocks.mockSelect },
}));

vi.mock('@/db/schema', () => ({
  chatRateLimits: {
    userId: 'user_id',
    tokens: 'tokens',
    refilledAt: 'refilled_at',
  },
}));

// drizzle-orm sql tag and eq helper — minimal stubs.
vi.mock('drizzle-orm', () => ({
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    { raw: (s: string) => s },
  ),
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
}));

import { checkAndConsumeRateLimit, RATE_LIMIT_CAP } from '../rate-limits';
import type { UserId } from '@/shared/types';

const USER_ID = 'a17c2f90-1234-4d56-89ab-000000000001' as UserId;

describe('checkAndConsumeRateLimit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns allowed:true with tokensRemaining when a row is returned', async () => {
    mocks.mockExecute.mockResolvedValue([{ tokens: 48, refilled_at: new Date().toISOString() }]);

    const result = await checkAndConsumeRateLimit(USER_ID);

    expect(result).toEqual({ allowed: true, tokensRemaining: 48 });
  });

  it('returns allowed:true with 0 tokens remaining when bucket is at last token', async () => {
    mocks.mockExecute.mockResolvedValue([{ tokens: 0, refilled_at: new Date().toISOString() }]);

    const result = await checkAndConsumeRateLimit(USER_ID);

    expect(result).toEqual({ allowed: true, tokensRemaining: 0 });
  });

  it('returns allowed:false with accurate retryAfterSeconds when exhausted (50 min ago)', async () => {
    // Bucket was last refilled 50 minutes ago → 10 minutes (600s) remain.
    const refilledAt = new Date(Date.now() - 50 * 60 * 1000);
    mocks.mockExecute.mockResolvedValue([]);
    mocks.mockWhere.mockResolvedValue([{ refilledAt }]);

    const result = await checkAndConsumeRateLimit(USER_ID);

    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      // ~600s remaining; allow ±2s for test execution time.
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(598);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(602);
    }
  });

  it('returns allowed:false with fallback 3600s when exhausted but no row found', async () => {
    mocks.mockExecute.mockResolvedValue([]);
    mocks.mockWhere.mockResolvedValue([]);

    const result = await checkAndConsumeRateLimit(USER_ID);

    expect(result).toEqual({ allowed: false, retryAfterSeconds: 3600 });
  });

  it('calls db.execute once per invocation on the allowed path', async () => {
    mocks.mockExecute.mockResolvedValue([{ tokens: 40, refilled_at: new Date().toISOString() }]);

    await checkAndConsumeRateLimit(USER_ID);

    expect(mocks.mockExecute).toHaveBeenCalledOnce();
    expect(mocks.mockSelect).not.toHaveBeenCalled();
  });

  it('calls db.select for refilled_at on the exhausted path', async () => {
    const refilledAt = new Date(Date.now() - 30 * 60 * 1000);
    mocks.mockExecute.mockResolvedValue([]);
    mocks.mockWhere.mockResolvedValue([{ refilledAt }]);

    await checkAndConsumeRateLimit(USER_ID);

    expect(mocks.mockSelect).toHaveBeenCalledOnce();
  });

  it('RATE_LIMIT_CAP is 50', () => {
    expect(RATE_LIMIT_CAP).toBe(50);
  });
});
