import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/db/queries/pending-changes', () => ({
  insertPendingChange: vi.fn(),
}));

import { insertPendingChange } from '@/db/queries/pending-changes';
import { handler } from '../create-rule-draft';

const ctx = { userId: brand<UserId>('user-1') };

const sampleProposal = {
  id: 'proposal-3',
  userId: 'user-1',
  kind: 'rule_create',
  payload: {},
  status: 'pending' as const,
  appliedAt: null,
  createdAt: new Date(),
};

describe('create-rule-draft handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a pending_changes proposal for a categorization rule', async () => {
    vi.mocked(insertPendingChange).mockResolvedValueOnce(sampleProposal);

    const result = await handler(
      { predicate: { merchantContains: 'Costco' }, setCategory: 'Groceries' },
      ctx,
    );

    expect(insertPendingChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'rule_create', status: 'pending' }),
    );
    expect(result.proposalId).toBe('proposal-3');
    expect(result.setCategory).toBe('Groceries');
    expect(result.predicate.merchantContains).toBe('Costco');
    expect(result.description).toContain('Costco');
    expect(result.description).toContain('Groceries');
  });

  it('uses the user-provided description when given', async () => {
    vi.mocked(insertPendingChange).mockResolvedValueOnce(sampleProposal);
    const result = await handler(
      {
        predicate: { merchantExact: 'Starbucks' },
        setCategory: 'Coffee',
        description: 'All Starbucks → Coffee',
      },
      ctx,
    );
    expect(result.description).toBe('All Starbucks → Coffee');
  });

  it('throws when predicate has no conditions', async () => {
    await expect(handler({ predicate: {}, setCategory: 'Groceries' }, ctx)).rejects.toThrow(
      'at least one condition',
    );
    expect(insertPendingChange).not.toHaveBeenCalled();
  });
});
