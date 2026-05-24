import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/db/queries/assets', () => ({
  getAssetById: vi.fn(),
}));
vi.mock('@/db/queries/pending-changes', () => ({
  insertPendingChange: vi.fn(),
}));

import { getAssetById } from '@/db/queries/assets';
import { insertPendingChange } from '@/db/queries/pending-changes';
import { handler } from '../update-asset';

const ctx = { userId: brand<UserId>('user-1') };

const sampleAsset = {
  id: 'asset-1',
  userId: 'user-1',
  kind: 'vehicle' as const,
  name: 'Tesla Model 3',
  valueCents: 4500000n,
  source: 'user' as const,
  confidence: 1.0,
  manualOverride: false,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const sampleProposal = {
  id: 'proposal-1',
  userId: 'user-1',
  kind: 'asset_update',
  payload: {},
  status: 'pending' as const,
  appliedAt: null,
  createdAt: new Date(),
};

describe('update-asset handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a pending_changes proposal with value change', async () => {
    vi.mocked(getAssetById).mockResolvedValueOnce(sampleAsset);
    vi.mocked(insertPendingChange).mockResolvedValueOnce(sampleProposal);

    const result = await handler({ assetId: 'asset-1', valueDollars: 48000 }, ctx);

    expect(insertPendingChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'asset_update', status: 'pending' }),
    );
    expect(result.proposalId).toBe('proposal-1');
    expect(result.assetName).toBe('Tesla Model 3');
    expect(result.changes.valueDollars).toEqual({ from: 45000, to: 48000 });
  });

  it('throws when asset does not exist', async () => {
    vi.mocked(getAssetById).mockResolvedValueOnce(undefined);
    await expect(handler({ assetId: 'missing-uuid', valueDollars: 1000 }, ctx)).rejects.toThrow(
      'not found',
    );
    expect(insertPendingChange).not.toHaveBeenCalled();
  });

  it('throws when no changes are specified', async () => {
    vi.mocked(getAssetById).mockResolvedValueOnce(sampleAsset);
    await expect(handler({ assetId: 'asset-1' }, ctx)).rejects.toThrow('No changes specified');
    expect(insertPendingChange).not.toHaveBeenCalled();
  });

  it('rejects if asset belongs to another user', async () => {
    vi.mocked(getAssetById).mockResolvedValueOnce({ ...sampleAsset, userId: 'other-user' });
    await expect(handler({ assetId: 'asset-1', valueDollars: 1000 }, ctx)).rejects.toThrow(
      'not found',
    );
  });
});
