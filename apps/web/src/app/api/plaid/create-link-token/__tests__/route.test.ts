import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAuth, mockFindUser, mockLinkTokenCreate } = vi.hoisted(() => {
  const mockAuth = vi.fn();
  const mockFindUser = vi.fn();
  const mockLinkTokenCreate = vi.fn();
  return { mockAuth, mockFindUser, mockLinkTokenCreate };
});

vi.mock('@clerk/nextjs/server', () => ({ auth: mockAuth }));
vi.mock('@/db/queries/users', () => ({ findUserByClerkId: mockFindUser }));
vi.mock('@/lib/plaid', () => ({
  plaidClient: { linkTokenCreate: mockLinkTokenCreate },
}));

import { POST } from '../route';

describe('POST /api/plaid/create-link-token', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('returns 404 when user row does not exist', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(undefined);
    const res = await POST();
    expect(res.status).toBe(404);
  });

  it('returns link_token on success', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue({ id: 'user-uuid', clerkId: 'clerk_abc' });
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
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue({ id: 'user-uuid', clerkId: 'clerk_abc' });
    mockLinkTokenCreate.mockRejectedValue(new Error('Plaid error'));

    const res = await POST();
    expect(res.status).toBe(500);
  });
});
