import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockGetTransactions,
  mockUpsertRecurringSeries,
  mockDetectRecurringSeries,
  mockInsertAuditEvent,
} = vi.hoisted(() => ({
  mockGetTransactions: vi.fn(),
  mockUpsertRecurringSeries: vi.fn(),
  mockDetectRecurringSeries: vi.fn(),
  mockInsertAuditEvent: vi.fn(),
}));

vi.mock('@/db/queries/recurring-series', () => ({
  getTransactionsForRecurringDetection: mockGetTransactions,
  upsertRecurringSeries: mockUpsertRecurringSeries,
}));

vi.mock('@/lib/enrich/recurring-series', () => ({
  detectRecurringSeries: mockDetectRecurringSeries,
}));

vi.mock('@/db/queries/audit-events', () => ({
  insertAuditEvent: mockInsertAuditEvent,
}));

import {
  handleDetectRecurring,
  type DetectRecurringContext,
} from '../detect-recurring';
import type { UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep() {
  return {
    run: vi.fn().mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn()),
  };
}

function makeCtx(userId = 'user-uuid'): DetectRecurringContext {
  return { event: { data: { userId } }, step: makeStep() };
}

function makeSeries(merchant = 'Netflix', cadence = 'monthly' as const) {
  return {
    userId: 'user-uuid' as UserId,
    merchantNormalized: merchant,
    cadence,
    expectedAmountCents: 1599n,
    amountTolerancePct: 0.1,
    nextExpectedAt: '2024-04-15',
    lastSeenAt: '2024-03-15',
    confidence: 0.85,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleDetectRecurring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertRecurringSeries.mockResolvedValue('series-uuid');
    mockInsertAuditEvent.mockResolvedValue(undefined);
  });

  it('returns zero seriesFound when no eligible transactions', async () => {
    mockGetTransactions.mockResolvedValue([]);
    mockDetectRecurringSeries.mockReturnValue([]);

    const result = await handleDetectRecurring(makeCtx());

    expect(result).toEqual({ userId: 'user-uuid', seriesFound: 0 });
    expect(mockDetectRecurringSeries).not.toHaveBeenCalled();
    expect(mockUpsertRecurringSeries).not.toHaveBeenCalled();
  });

  it('calls detectRecurringSeries with fetched candidates and userId', async () => {
    const candidates = [
      { merchantNormalized: 'Netflix', amountCents: 1599n, postedAt: '2024-01-15' },
    ];
    mockGetTransactions.mockResolvedValue(candidates);
    mockDetectRecurringSeries.mockReturnValue([]);

    await handleDetectRecurring(makeCtx('user-uuid'));

    expect(mockDetectRecurringSeries).toHaveBeenCalledWith(candidates, 'user-uuid');
  });

  it('upserts series and writes audit event per detected series', async () => {
    const candidates = [
      { merchantNormalized: 'Netflix', amountCents: 1599n, postedAt: '2024-01-15' },
    ];
    mockGetTransactions.mockResolvedValue(candidates);
    mockDetectRecurringSeries.mockReturnValue([makeSeries()]);

    const result = await handleDetectRecurring(makeCtx());

    expect(result).toEqual({ userId: 'user-uuid', seriesFound: 1 });

    expect(mockUpsertRecurringSeries).toHaveBeenCalledOnce();
    expect(mockUpsertRecurringSeries).toHaveBeenCalledWith(
      expect.objectContaining({
        merchantNormalized: 'Netflix',
        cadence: 'monthly',
        expectedAmountCents: 1599n,
        confidence: 0.85,
      }),
    );

    expect(mockInsertAuditEvent).toHaveBeenCalledOnce();
    expect(mockInsertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'enrichment.recurring_detect',
        entityType: 'recurring_series',
        entityId: 'series-uuid',
        source: 'system',
        confidence: 0.85,
      }),
    );
  });

  it('handles multiple detected series in one run', async () => {
    const candidates = [
      { merchantNormalized: 'Netflix', amountCents: 1599n, postedAt: '2024-01-15' },
      { merchantNormalized: 'Spotify', amountCents: 999n, postedAt: '2024-01-20' },
    ];
    mockGetTransactions.mockResolvedValue(candidates);
    mockDetectRecurringSeries.mockReturnValue([
      makeSeries('Netflix'),
      makeSeries('Spotify'),
    ]);

    const result = await handleDetectRecurring(makeCtx());

    expect(result.seriesFound).toBe(2);
    expect(mockUpsertRecurringSeries).toHaveBeenCalledTimes(2);
    expect(mockInsertAuditEvent).toHaveBeenCalledTimes(2);
  });

  it('returns zero seriesFound when candidates exist but none detected', async () => {
    const candidates = [
      { merchantNormalized: 'OneTime', amountCents: 9999n, postedAt: '2024-01-01' },
    ];
    mockGetTransactions.mockResolvedValue(candidates);
    mockDetectRecurringSeries.mockReturnValue([]);

    const result = await handleDetectRecurring(makeCtx());

    expect(result).toEqual({ userId: 'user-uuid', seriesFound: 0 });
    expect(mockUpsertRecurringSeries).not.toHaveBeenCalled();
    expect(mockInsertAuditEvent).not.toHaveBeenCalled();
  });
});
