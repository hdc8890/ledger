import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/db/queries/transactions', () => ({
  getTransactionById: vi.fn(),
}));
vi.mock('@/db/queries/pending-changes', () => ({
  insertPendingChange: vi.fn(),
}));

import { getTransactionById } from '@/db/queries/transactions';
import { insertPendingChange } from '@/db/queries/pending-changes';
import { handler } from '../tag-transaction';

const ctx = { userId: brand<UserId>('user-1') };

const sampleTxn = {
  id: 'txn-1',
  userId: 'user-1',
  accountId: 'acct-1',
  plaidTransactionId: 'plaid-1',
  postedAt: '2025-10-15',
  authorizedAt: null,
  amountCents: 7500n,
  currency: 'USD',
  merchantRaw: 'COSTCO WHSE #0123',
  merchantNormalized: 'Costco',
  category: 'Shopping',
  categorySource: 'plaid' as const,
  categoryConfidence: 0.7,
  pending: false,
  source: 'plaid' as const,
  confidence: 1.0,
  isTransfer: false,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sampleProposal = {
  id: 'proposal-2',
  userId: 'user-1',
  kind: 'txn_tag',
  payload: {},
  status: 'pending' as const,
  appliedAt: null,
  createdAt: new Date(),
};

describe('tag-transaction handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a pending_changes proposal for a category change', async () => {
    vi.mocked(getTransactionById).mockResolvedValueOnce(sampleTxn);
    vi.mocked(insertPendingChange).mockResolvedValueOnce(sampleProposal);

    const result = await handler({ transactionId: 'txn-1', category: 'Groceries' }, ctx);

    expect(insertPendingChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'txn_tag', status: 'pending' }),
    );
    expect(result.proposalId).toBe('proposal-2');
    expect(result.currentCategory).toBe('Shopping');
    expect(result.proposedCategory).toBe('Groceries');
    expect(result.merchantRaw).toBe('COSTCO WHSE #0123');
  });

  it('throws when transaction does not exist', async () => {
    vi.mocked(getTransactionById).mockResolvedValueOnce(undefined);
    await expect(
      handler({ transactionId: 'missing-txn', category: 'Groceries' }, ctx),
    ).rejects.toThrow('not found');
    expect(insertPendingChange).not.toHaveBeenCalled();
  });

  it('rejects if transaction belongs to another user', async () => {
    vi.mocked(getTransactionById).mockResolvedValueOnce({ ...sampleTxn, userId: 'other-user' });
    await expect(
      handler({ transactionId: 'txn-1', category: 'Groceries' }, ctx),
    ).rejects.toThrow('not found');
  });
});
