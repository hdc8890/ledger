import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — mock factories defined before vi.mock calls
// ---------------------------------------------------------------------------

const {
  mockGetAllUsers,
  mockGetAssetBreakdown,
  mockGetDebtSummary,
  mockGetLatestNetWorthSnapshot,
  mockGetSnapshotDatesBetween,
  mockUpsertNetWorthSnapshot,
} = vi.hoisted(() => ({
  mockGetAllUsers: vi.fn(),
  mockGetAssetBreakdown: vi.fn(),
  mockGetDebtSummary: vi.fn(),
  mockGetLatestNetWorthSnapshot: vi.fn(),
  mockGetSnapshotDatesBetween: vi.fn(),
  mockUpsertNetWorthSnapshot: vi.fn(),
}));

vi.mock('@/db/queries/users', () => ({
  getAllUsers: mockGetAllUsers,
}));

vi.mock('@/db/queries/assets', () => ({
  getAssetBreakdown: mockGetAssetBreakdown,
}));

vi.mock('@/db/queries/liabilities', () => ({
  getDebtSummary: mockGetDebtSummary,
}));

vi.mock('@/db/queries/net-worth', () => ({
  getLatestNetWorthSnapshot: mockGetLatestNetWorthSnapshot,
  getSnapshotDatesBetween: mockGetSnapshotDatesBetween,
  upsertNetWorthSnapshot: mockUpsertNetWorthSnapshot,
}));

import {
  computeAndUpsertSnapshot,
  handleNetWorthSnapshot,
  type NetWorthSnapshotContext,
} from '../net-worth-snapshot';
import type { UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep() {
  return {
    run: vi.fn().mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn()),
  };
}

const USER_ID = 'user-uuid-1' as UserId;

const FAKE_USER = { id: USER_ID, clerkId: 'clerk-1', settings: {}, householdId: null, createdAt: new Date(), updatedAt: new Date() };

const FAKE_BREAKDOWN = [
  { kind: 'home' as const, totalCents: 500_000_00n, count: 1 },
  { kind: 'brokerage' as const, totalCents: 100_000_00n, count: 1 },
];

const FAKE_DEBT = {
  totalBalanceCents: 200_000_00n,
  estimatedMonthlyMinimumCents: null,
  byKind: [],
};

const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// computeAndUpsertSnapshot
// ---------------------------------------------------------------------------

describe('computeAndUpsertSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAssetBreakdown.mockResolvedValue(FAKE_BREAKDOWN);
    mockGetDebtSummary.mockResolvedValue(FAKE_DEBT);
    mockUpsertNetWorthSnapshot.mockResolvedValue({});
  });

  it('happy path — no prior snapshot: upserts exactly today\'s snapshot', async () => {
    mockGetLatestNetWorthSnapshot.mockResolvedValue(undefined);

    const count = await computeAndUpsertSnapshot(USER_ID);

    expect(count).toBe(1);
    expect(mockUpsertNetWorthSnapshot).toHaveBeenCalledOnce();

    const call = mockUpsertNetWorthSnapshot.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.snapshotDate).toBe(TODAY);
    expect(call?.assetsCents).toBe(600_000_00n); // 500_000_00 + 100_000_00
    expect(call?.liabilitiesCents).toBe(200_000_00n);
    expect(call?.userId).toBe(USER_ID);
  });

  it('idempotent — if today\'s snapshot already exists, upserts it again (no-op semantics)', async () => {
    mockGetLatestNetWorthSnapshot.mockResolvedValue({
      snapshotDate: TODAY,
      assetsCents: 600_000_00n,
      liabilitiesCents: 200_000_00n,
      breakdown: {},
    });
    mockGetSnapshotDatesBetween.mockResolvedValue(new Set([TODAY]));

    const count = await computeAndUpsertSnapshot(USER_ID);

    // Today is the last snapshot; no gaps; today is still upserted once.
    expect(count).toBe(1);
    expect(mockUpsertNetWorthSnapshot).toHaveBeenCalledOnce();
  });

  it('backfill — fills gap days between last snapshot and today', async () => {
    // Simulate last snapshot was 3 days ago
    const threeDaysAgo = new Date();
    threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 3);
    const threeDaysAgoStr = threeDaysAgo.toISOString().slice(0, 10);

    mockGetLatestNetWorthSnapshot.mockResolvedValue({
      snapshotDate: threeDaysAgoStr,
      assetsCents: 500_000_00n,
      liabilitiesCents: 200_000_00n,
      breakdown: {},
    });
    // No existing rows in the gap range
    mockGetSnapshotDatesBetween.mockResolvedValue(new Set<string>());

    const count = await computeAndUpsertSnapshot(USER_ID);

    // Should fill 3 gap days + today = 3 upserts (days 3, 2, 1 ago + today)
    expect(count).toBe(3);
    expect(mockUpsertNetWorthSnapshot).toHaveBeenCalledTimes(3);
  });

  it('serializes breakdown values as strings in the JSON payload', async () => {
    mockGetLatestNetWorthSnapshot.mockResolvedValue(undefined);

    await computeAndUpsertSnapshot(USER_ID);

    const call = mockUpsertNetWorthSnapshot.mock.calls[0]?.[0] as Record<string, unknown>;
    const breakdown = call?.breakdown as Record<string, unknown>;
    expect(breakdown?.home).toBe('50000000');
    expect(breakdown?.brokerage).toBe('10000000');
  });

  it('handles user with no assets or liabilities', async () => {
    mockGetAssetBreakdown.mockResolvedValue([]);
    mockGetDebtSummary.mockResolvedValue({ totalBalanceCents: 0n, estimatedMonthlyMinimumCents: null, byKind: [] });
    mockGetLatestNetWorthSnapshot.mockResolvedValue(undefined);

    const count = await computeAndUpsertSnapshot(USER_ID);

    expect(count).toBe(1);
    const call = mockUpsertNetWorthSnapshot.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call?.assetsCents).toBe(0n);
    expect(call?.liabilitiesCents).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// handleNetWorthSnapshot
// ---------------------------------------------------------------------------

describe('handleNetWorthSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAssetBreakdown.mockResolvedValue(FAKE_BREAKDOWN);
    mockGetDebtSummary.mockResolvedValue(FAKE_DEBT);
    mockGetLatestNetWorthSnapshot.mockResolvedValue(undefined);
    mockUpsertNetWorthSnapshot.mockResolvedValue({});
  });

  it('returns zero counts when no users exist', async () => {
    mockGetAllUsers.mockResolvedValue([]);

    const ctx: NetWorthSnapshotContext = { step: makeStep() };
    const result = await handleNetWorthSnapshot(ctx);

    expect(result).toEqual({ usersProcessed: 0, usersFailed: 0, snapshotsCreated: 0 });
    expect(mockUpsertNetWorthSnapshot).not.toHaveBeenCalled();
  });

  it('happy path — processes each user as a separate step', async () => {
    const user2 = { ...FAKE_USER, id: 'user-uuid-2' as UserId, clerkId: 'clerk-2' };
    mockGetAllUsers.mockResolvedValue([FAKE_USER, user2]);

    const ctx: NetWorthSnapshotContext = { step: makeStep() };
    const result = await handleNetWorthSnapshot(ctx);

    expect(result.usersProcessed).toBe(2);
    expect(result.usersFailed).toBe(0);
    expect(result.snapshotsCreated).toBe(2); // 1 snapshot per user
  });
});
