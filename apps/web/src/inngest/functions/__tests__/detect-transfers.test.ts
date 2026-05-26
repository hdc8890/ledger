import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockGetTransactionsForTransferDetection,
  mockUpsertTransferLink,
  mockMarkTransactionAsTransfer,
  mockDetectTransferPairs,
  mockInsertAuditEvent,
} = vi.hoisted(() => ({
  mockGetTransactionsForTransferDetection: vi.fn(),
  mockUpsertTransferLink: vi.fn(),
  mockMarkTransactionAsTransfer: vi.fn(),
  mockDetectTransferPairs: vi.fn(),
  mockInsertAuditEvent: vi.fn(),
}));

vi.mock('@/db/queries/transfer-links', () => ({
  getTransactionsForTransferDetection: mockGetTransactionsForTransferDetection,
  upsertTransferLink: mockUpsertTransferLink,
  markTransactionAsTransfer: mockMarkTransactionAsTransfer,
}));

vi.mock('@/lib/enrich/detect-transfers', () => ({
  detectTransferPairs: mockDetectTransferPairs,
}));

vi.mock('@/db/queries/audit-events', () => ({
  insertAuditEvent: mockInsertAuditEvent,
}));

import {
  handleDetectTransfers,
  type DetectTransfersContext,
} from '../detect-transfers';
import type { TransactionId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStep() {
  return {
    run: vi.fn().mockImplementation(async (_id: string, fn: () => Promise<unknown>) => fn()),
    sendEvent: vi.fn().mockResolvedValue(undefined),
  };
}

function makeCtx(userId = 'user-uuid'): DetectTransfersContext {
  return { event: { data: { userId } }, step: makeStep() };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleDetectTransfers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkTransactionAsTransfer.mockResolvedValue(undefined);
    mockUpsertTransferLink.mockResolvedValue(undefined);
    mockInsertAuditEvent.mockResolvedValue(undefined);
  });

  it('returns zero pairsFound when no eligible transactions', async () => {
    mockGetTransactionsForTransferDetection.mockResolvedValue([]);
    mockDetectTransferPairs.mockReturnValue([]);

    const result = await handleDetectTransfers(makeCtx());

    expect(result).toEqual({ userId: 'user-uuid', pairsFound: 0 });
    expect(mockDetectTransferPairs).not.toHaveBeenCalled();
    expect(mockMarkTransactionAsTransfer).not.toHaveBeenCalled();
  });

  it('calls detectTransferPairs with fetched candidates', async () => {
    const candidates = [
      { id: 'txn-out' as TransactionId, accountId: 'acct-A', amountCents: 10000n, postedAt: '2024-01-15' },
      { id: 'txn-in' as TransactionId, accountId: 'acct-B', amountCents: -10000n, postedAt: '2024-01-15' },
    ];
    mockGetTransactionsForTransferDetection.mockResolvedValue(candidates);
    mockDetectTransferPairs.mockReturnValue([]);

    await handleDetectTransfers(makeCtx());

    expect(mockDetectTransferPairs).toHaveBeenCalledWith(candidates);
  });

  it('marks both legs as transfers and inserts link + audit events per pair', async () => {
    const candidates = [
      { id: 'txn-out' as TransactionId, accountId: 'acct-A', amountCents: 10000n, postedAt: '2024-01-15' },
      { id: 'txn-in' as TransactionId, accountId: 'acct-B', amountCents: -10000n, postedAt: '2024-01-15' },
    ];
    mockGetTransactionsForTransferDetection.mockResolvedValue(candidates);
    mockDetectTransferPairs.mockReturnValue([
      { outTxnId: 'txn-out' as TransactionId, inTxnId: 'txn-in' as TransactionId, confidence: 0.99 },
    ]);

    const result = await handleDetectTransfers(makeCtx());

    expect(result).toEqual({ userId: 'user-uuid', pairsFound: 1 });

    // Both transaction legs must be marked.
    expect(mockMarkTransactionAsTransfer).toHaveBeenCalledTimes(2);
    expect(mockMarkTransactionAsTransfer).toHaveBeenCalledWith('txn-out');
    expect(mockMarkTransactionAsTransfer).toHaveBeenCalledWith('txn-in');

    // Transfer link must be persisted.
    expect(mockUpsertTransferLink).toHaveBeenCalledOnce();
    expect(mockUpsertTransferLink).toHaveBeenCalledWith(
      expect.objectContaining({ outTxnId: 'txn-out', inTxnId: 'txn-in', confidence: 0.99 }),
    );

    // Two audit events — one per leg.
    expect(mockInsertAuditEvent).toHaveBeenCalledTimes(2);
    expect(mockInsertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'enrichment.transfer_detect',
        entityId: 'txn-out',
        source: 'system',
        confidence: 0.99,
      }),
    );
    expect(mockInsertAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'enrichment.transfer_detect',
        entityId: 'txn-in',
        source: 'system',
        confidence: 0.99,
      }),
    );
  });

  it('handles multiple pairs in one run', async () => {
    const candidates = [
      { id: 'out1' as TransactionId, accountId: 'A', amountCents: 5000n, postedAt: '2024-01-10' },
      { id: 'in1' as TransactionId, accountId: 'B', amountCents: -5000n, postedAt: '2024-01-10' },
      { id: 'out2' as TransactionId, accountId: 'C', amountCents: 20000n, postedAt: '2024-01-12' },
      { id: 'in2' as TransactionId, accountId: 'D', amountCents: -20000n, postedAt: '2024-01-12' },
    ];
    mockGetTransactionsForTransferDetection.mockResolvedValue(candidates);
    mockDetectTransferPairs.mockReturnValue([
      { outTxnId: 'out1' as TransactionId, inTxnId: 'in1' as TransactionId, confidence: 0.99 },
      { outTxnId: 'out2' as TransactionId, inTxnId: 'in2' as TransactionId, confidence: 0.99 },
    ]);

    const result = await handleDetectTransfers(makeCtx());

    expect(result.pairsFound).toBe(2);
    expect(mockMarkTransactionAsTransfer).toHaveBeenCalledTimes(4);
    expect(mockUpsertTransferLink).toHaveBeenCalledTimes(2);
    expect(mockInsertAuditEvent).toHaveBeenCalledTimes(4);
  });

  it('returns zero pairsFound when candidates exist but no pairs detected', async () => {
    const candidates = [
      { id: 'lone' as TransactionId, accountId: 'A', amountCents: 10000n, postedAt: '2024-01-15' },
    ];
    mockGetTransactionsForTransferDetection.mockResolvedValue(candidates);
    mockDetectTransferPairs.mockReturnValue([]);

    const result = await handleDetectTransfers(makeCtx());

    expect(result).toEqual({ userId: 'user-uuid', pairsFound: 0 });
    expect(mockMarkTransactionAsTransfer).not.toHaveBeenCalled();
    expect(mockUpsertTransferLink).not.toHaveBeenCalled();
    expect(mockInsertAuditEvent).not.toHaveBeenCalled();
  });

  it('always chains to detect-recurring after completing', async () => {
    mockGetTransactionsForTransferDetection.mockResolvedValue([]);
    mockDetectTransferPairs.mockReturnValue([]);

    const ctx = makeCtx();
    await handleDetectTransfers(ctx);

    expect(ctx.step.sendEvent).toHaveBeenCalledOnce();
    expect(ctx.step.sendEvent).toHaveBeenCalledWith(
      'enqueue-recurring-detection',
      expect.objectContaining({
        name: 'enrichment/transactions.detect-recurring',
        data: { userId: 'user-uuid' },
      }),
    );
  });
});
