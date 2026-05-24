import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/db/queries/accounts', () => ({
  getAccountsByUserId: vi.fn(),
}));

import { getAccountsByUserId } from '@/db/queries/accounts';
import { handler } from '../get-accounts';

const ctx = { userId: brand<UserId>('user-1') };

const sampleAccount = {
  id: 'acct-1',
  userId: 'user-1',
  plaidItemId: 'item-1',
  plaidAccountId: 'plaid-1',
  name: 'Checking',
  officialName: 'Chase Checking',
  mask: '0001',
  type: 'depository',
  subtype: 'checking',
  currency: 'USD',
  balanceCurrent: 500000n,
  balanceAvailable: 490000n,
  lastSyncedAt: null,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('get-accounts handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted account list', async () => {
    vi.mocked(getAccountsByUserId).mockResolvedValueOnce([sampleAccount]);
    const result = await handler({}, ctx);
    expect(result.totalAccounts).toBe(1);
    expect(result.accounts[0]).toMatchObject({
      id: 'acct-1',
      name: 'Checking',
      balanceCurrentDollars: 5000,
      balanceAvailableDollars: 4900,
    });
  });

  it('returns empty list when user has no accounts', async () => {
    vi.mocked(getAccountsByUserId).mockResolvedValueOnce([]);
    const result = await handler({}, ctx);
    expect(result.totalAccounts).toBe(0);
    expect(result.accounts).toHaveLength(0);
  });
});
