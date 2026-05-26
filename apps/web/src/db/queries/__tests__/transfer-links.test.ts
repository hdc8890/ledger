import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted mocks — db, schema, drizzle-orm, audit-events
// ---------------------------------------------------------------------------

const {
  mockDbUpdate,
  mockDbDelete,
  mockInsertAuditEvent,
} = vi.hoisted(() => {
  // Each DB method needs to produce a chain that is directly awaitable at
  // the terminal step. Drizzle builders are thenable at the last call.
  const resolved = Promise.resolve(undefined);

  const makeDeleteChain = () => {
    const where = vi.fn(() => resolved);
    const del = vi.fn(() => ({ where }));
    return del;
  };

  const makeUpdateChain = () => {
    const where = vi.fn(() => resolved);
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    return update;
  };

  const mockDbDelete = makeDeleteChain();
  const mockDbUpdate = makeUpdateChain();
  const mockInsertAuditEvent = vi.fn().mockResolvedValue(undefined);

  return { mockDbUpdate, mockDbDelete, mockInsertAuditEvent };
});

vi.mock('@/lib/db', () => ({
  db: { update: mockDbUpdate, delete: mockDbDelete },
}));

vi.mock('@/db/schema', () => ({
  transferLinks: {
    userId: 'user_id',
    outTxnId: 'out_txn_id',
    inTxnId: 'in_txn_id',
    confidence: 'confidence',
  },
  transactions: {
    id: 'id',
    userId: 'user_id',
    isTransfer: 'is_transfer',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => `${col}=${val}`),
  and: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
}));

vi.mock('@/db/queries/audit-events', () => ({
  insertAuditEvent: mockInsertAuditEvent,
}));

import { unlinkTransferPair } from '../transfer-links';
import type { TransactionId, UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('unlinkTransferPair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertAuditEvent.mockResolvedValue(undefined);
  });

  it('deletes the transfer_links row', async () => {
    await unlinkTransferPair(
      'txn-out' as TransactionId,
      'txn-in' as TransactionId,
      'user-uuid' as UserId,
    );

    expect(mockDbDelete).toHaveBeenCalledOnce();
  });

  it('resets isTransfer on both transaction legs', async () => {
    await unlinkTransferPair(
      'txn-out' as TransactionId,
      'txn-in' as TransactionId,
      'user-uuid' as UserId,
    );

    // One update call per transaction leg.
    expect(mockDbUpdate).toHaveBeenCalledTimes(2);
  });

  it('writes two audit events with source=user', async () => {
    await unlinkTransferPair(
      'txn-out' as TransactionId,
      'txn-in' as TransactionId,
      'user-uuid' as UserId,
    );

    expect(mockInsertAuditEvent).toHaveBeenCalledTimes(2);

    // Both audit events must be user-sourced.
    for (const call of mockInsertAuditEvent.mock.calls) {
      expect(call[0]).toMatchObject({
        action: 'enrichment.transfer_unlink',
        source: 'user',
        confidence: 1.0,
        before: { isTransfer: true },
        after: expect.objectContaining({ isTransfer: false }),
      });
    }
  });

  it('includes the peer transaction ID in each audit event', async () => {
    await unlinkTransferPair(
      'txn-out' as TransactionId,
      'txn-in' as TransactionId,
      'user-uuid' as UserId,
    );

    const calls = mockInsertAuditEvent.mock.calls.map((c) => c[0] as { entityId: string; after: { unlinkedPeer: string } });
    const outCall = calls.find((c) => c.entityId === 'txn-out');
    const inCall = calls.find((c) => c.entityId === 'txn-in');

    expect(outCall?.after.unlinkedPeer).toBe('txn-in');
    expect(inCall?.after.unlinkedPeer).toBe('txn-out');
  });
});
