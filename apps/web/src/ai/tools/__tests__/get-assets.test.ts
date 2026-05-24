import { describe, it, expect, vi, beforeEach } from 'vitest';
import { brand } from '@/shared/types';
import type { UserId } from '@/shared/types';

vi.mock('@/db/queries/assets', () => ({
  getAssetsByUserId: vi.fn(),
}));

import { getAssetsByUserId } from '@/db/queries/assets';
import { handler } from '../get-assets';

const ctx = { userId: brand<UserId>('user-1') };

const sampleAsset = {
  id: 'asset-1',
  userId: 'user-1',
  kind: 'home' as const,
  name: 'Primary Residence',
  valueCents: 45000000n,
  source: 'user' as const,
  confidence: 1.0,
  manualOverride: true,
  metadata: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('get-assets handler', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns formatted asset list with total', async () => {
    vi.mocked(getAssetsByUserId).mockResolvedValueOnce([sampleAsset]);
    const result = await handler({}, ctx);
    expect(result.totalAssets).toBe(1);
    expect(result.assets[0]).toMatchObject({
      id: 'asset-1',
      kind: 'home',
      valueDollars: 450000,
      manualOverride: true,
    });
    expect(result.totalValueDollars).toBe(450000);
  });

  it('returns zero total when no assets', async () => {
    vi.mocked(getAssetsByUserId).mockResolvedValueOnce([]);
    const result = await handler({}, ctx);
    expect(result.totalAssets).toBe(0);
    expect(result.totalValueDollars).toBe(0);
  });
});
