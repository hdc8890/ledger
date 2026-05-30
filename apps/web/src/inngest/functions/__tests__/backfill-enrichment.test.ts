import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockGetAllUsers,
  mockGetUserById,
  mockResetTransactionEnrichmentForUser,
  mockInsertAuditEvent,
} = vi.hoisted(() => ({
  mockGetAllUsers: vi.fn(),
  mockGetUserById: vi.fn(),
  mockResetTransactionEnrichmentForUser: vi.fn(),
  mockInsertAuditEvent: vi.fn(),
}));

vi.mock('@/db/queries/users', () => ({
  getAllUsers: mockGetAllUsers,
  getUserById: mockGetUserById,
}));

vi.mock('@/db/queries/transactions', () => ({
  resetTransactionEnrichmentForUser: mockResetTransactionEnrichmentForUser,
}));

vi.mock('@/db/queries/audit-events', () => ({
  insertAuditEvent: mockInsertAuditEvent,
}));

import { handleBackfillEnrichment, type BackfillEnrichmentContext } from '../backfill-enrichment';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep() {
  return {
    run: vi.fn().mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn()),
    sendEvent: vi.fn().mockResolvedValue({}),
    sleep: vi.fn().mockResolvedValue(undefined),
  };
}

function makeUser(id: string) {
  return { id, name: null, email: `${id}@example.com`, emailVerified: null, image: null, householdId: null, settings: {}, createdAt: new Date(), updatedAt: new Date() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleBackfillEnrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertAuditEvent.mockResolvedValue({});
    mockResetTransactionEnrichmentForUser.mockResolvedValue(0);
  });

  it('returns zero counts when no users exist', async () => {
    mockGetAllUsers.mockResolvedValue([]);

    const ctx: BackfillEnrichmentContext = {
      event: { data: {} },
      step: makeStep(),
    };

    const result = await handleBackfillEnrichment(ctx);

    expect(result).toEqual({ fanned: 0, reset: 0 });
    expect(ctx.step.sendEvent).not.toHaveBeenCalled();
    expect(ctx.step.sleep).not.toHaveBeenCalled();
  });

  it('emits normalize event for each user without sleeping for a single user', async () => {
    mockGetAllUsers.mockResolvedValue([makeUser('user-1')]);

    const ctx: BackfillEnrichmentContext = {
      event: { data: {} },
      step: makeStep(),
    };

    const result = await handleBackfillEnrichment(ctx);

    expect(result).toEqual({ fanned: 1, reset: 0 });
    expect(ctx.step.sendEvent).toHaveBeenCalledOnce();
    expect(ctx.step.sendEvent).toHaveBeenCalledWith('enqueue-normalize-0', {
      name: 'enrichment/transactions.normalize',
      data: { userId: 'user-1' },
    });
    // No sleep needed for a single user
    expect(ctx.step.sleep).not.toHaveBeenCalled();
  });

  it('emits normalize events for multiple users and sleeps between them', async () => {
    mockGetAllUsers.mockResolvedValue([
      makeUser('user-1'),
      makeUser('user-2'),
      makeUser('user-3'),
    ]);

    const ctx: BackfillEnrichmentContext = {
      event: { data: {} },
      step: makeStep(),
    };

    const result = await handleBackfillEnrichment(ctx);

    expect(result).toEqual({ fanned: 3, reset: 0 });

    // 3 sendEvent calls
    expect(ctx.step.sendEvent).toHaveBeenCalledTimes(3);
    expect(ctx.step.sendEvent).toHaveBeenNthCalledWith(1, 'enqueue-normalize-0', {
      name: 'enrichment/transactions.normalize',
      data: { userId: 'user-1' },
    });
    expect(ctx.step.sendEvent).toHaveBeenNthCalledWith(2, 'enqueue-normalize-1', {
      name: 'enrichment/transactions.normalize',
      data: { userId: 'user-2' },
    });
    expect(ctx.step.sendEvent).toHaveBeenNthCalledWith(3, 'enqueue-normalize-2', {
      name: 'enrichment/transactions.normalize',
      data: { userId: 'user-3' },
    });

    // 2 sleeps (N-1 for N users)
    expect(ctx.step.sleep).toHaveBeenCalledTimes(2);
    expect(ctx.step.sleep).toHaveBeenNthCalledWith(1, 'rate-limit-sleep-0', '2s');
    expect(ctx.step.sleep).toHaveBeenNthCalledWith(2, 'rate-limit-sleep-1', '2s');
  });

  it('resets enrichment state and emits when force=true', async () => {
    mockGetAllUsers.mockResolvedValue([makeUser('user-1')]);
    mockResetTransactionEnrichmentForUser.mockResolvedValue(15);

    const ctx: BackfillEnrichmentContext = {
      event: { data: { force: true } },
      step: makeStep(),
    };

    const result = await handleBackfillEnrichment(ctx);

    expect(result).toEqual({ fanned: 1, reset: 15 });
    expect(mockResetTransactionEnrichmentForUser).toHaveBeenCalledWith('user-1');
    expect(mockInsertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'enrichment.backfill_reset',
        entityType: 'user',
        entityId: 'user-1',
      }),
    );
    expect(ctx.step.sendEvent).toHaveBeenCalledWith('enqueue-normalize-0', expect.objectContaining({
      name: 'enrichment/transactions.normalize',
    }));
  });

  it('does not write audit event when force reset affects 0 rows', async () => {
    mockGetAllUsers.mockResolvedValue([makeUser('user-1')]);
    mockResetTransactionEnrichmentForUser.mockResolvedValue(0);

    const ctx: BackfillEnrichmentContext = {
      event: { data: { force: true } },
      step: makeStep(),
    };

    const result = await handleBackfillEnrichment(ctx);

    expect(result).toEqual({ fanned: 1, reset: 0 });
    expect(mockInsertAuditEvent).not.toHaveBeenCalled();
  });

  it('targets a single user when userId is provided', async () => {
    mockGetUserById.mockResolvedValue(makeUser('user-specific'));

    const ctx: BackfillEnrichmentContext = {
      event: { data: { userId: 'user-specific' } },
      step: makeStep(),
    };

    const result = await handleBackfillEnrichment(ctx);

    expect(result).toEqual({ fanned: 1, reset: 0 });
    expect(mockGetUserById).toHaveBeenCalledWith('user-specific');
    expect(mockGetAllUsers).not.toHaveBeenCalled();
    expect(ctx.step.sendEvent).toHaveBeenCalledWith('enqueue-normalize-0', {
      name: 'enrichment/transactions.normalize',
      data: { userId: 'user-specific' },
    });
  });

  it('force=false does not call reset even for multiple users', async () => {
    mockGetAllUsers.mockResolvedValue([makeUser('u1'), makeUser('u2')]);

    const ctx: BackfillEnrichmentContext = {
      event: { data: { force: false } },
      step: makeStep(),
    };

    await handleBackfillEnrichment(ctx);

    expect(mockResetTransactionEnrichmentForUser).not.toHaveBeenCalled();
  });
});
