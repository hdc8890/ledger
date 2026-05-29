import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetCurrentUserId, mockLinkTokenCreate } = vi.hoisted(() => {
  const mockGetCurrentUserId = vi.fn();
  const mockLinkTokenCreate = vi.fn();
  return { mockGetCurrentUserId, mockLinkTokenCreate };
});

vi.mock('@/lib/auth-helpers', () => ({ getCurrentUserId: mockGetCurrentUserId }));
vi.mock('@/lib/plaid', () => ({
  plaidClient: { linkTokenCreate: mockLinkTokenCreate },
}));

import { POST } from '../route';

describe('POST /api/plaid/create-link-token', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    mockGetCurrentUserId.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('returns link_token on success', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-uuid');
    mockLinkTokenCreate.mockResolvedValue({ data: { link_token: 'link-sandbox-123' } });

    const res = await POST();

    expect(res.status).toBe(200);
    const body = await res.json() as { link_token: string };
    expect(body.link_token).toBe('link-sandbox-123');
    expect(mockLinkTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({ user: { client_user_id: 'user-uuid' } }),
    );
  });

  it('returns 500 when Plaid throws', async () => {
    mockGetCurrentUserId.mockResolvedValue('user-uuid');
    mockLinkTokenCreate.mockRejectedValue(new Error('Plaid error'));

    const res = await POST();
    expect(res.status).toBe(500);
  });
});
