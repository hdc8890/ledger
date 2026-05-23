import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAuth,
  mockFindUser,
  mockInsertItem,
  mockUpsertAccount,
  mockInsertAudit,
  mockEncrypt,
  mockExchange,
  mockAccountsGet,
} = vi.hoisted(() => {
  const mockAuth = vi.fn();
  const mockFindUser = vi.fn();
  const mockInsertItem = vi.fn();
  const mockUpsertAccount = vi.fn();
  const mockInsertAudit = vi.fn();
  const mockEncrypt = vi.fn();
  const mockExchange = vi.fn();
  const mockAccountsGet = vi.fn();
  return {
    mockAuth,
    mockFindUser,
    mockInsertItem,
    mockUpsertAccount,
    mockInsertAudit,
    mockEncrypt,
    mockExchange,
    mockAccountsGet,
  };
});

vi.mock('@clerk/nextjs/server', () => ({ auth: mockAuth }));
vi.mock('@/db/queries/users', () => ({ findUserByClerkId: mockFindUser }));
vi.mock('@/db/queries/plaid-items', () => ({ insertPlaidItem: mockInsertItem }));
vi.mock('@/db/queries/accounts', () => ({ upsertAccount: mockUpsertAccount }));
vi.mock('@/db/queries/audit-events', () => ({ insertAuditEvent: mockInsertAudit }));
vi.mock('@/lib/encrypt', () => ({ encryptSecret: mockEncrypt }));
vi.mock('@/lib/plaid', () => ({
  plaidClient: { itemPublicTokenExchange: mockExchange, accountsGet: mockAccountsGet },
}));

import { POST } from '../route';

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/plaid/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  publicToken: 'public-sandbox-abc',
  institutionId: 'ins_1',
  institutionName: 'Test Bank',
};

const mockUser = { id: 'user-uuid', clerkId: 'clerk_abc' };

const mockItem = {
  id: 'item-uuid',
  userId: 'user-uuid',
  accessTokenEnc: 'enc-token',
  institutionId: 'ins_1',
  institutionName: 'Test Bank',
  status: 'active',
  cursor: null,
  lastSyncedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockPlaidAccount = {
  account_id: 'plaid-acct-1',
  name: 'Checking',
  official_name: null,
  mask: '0001',
  type: 'depository',
  subtype: 'checking',
  balances: { current: 1000, available: 950, iso_currency_code: 'USD' },
};

const mockSavedAccount = {
  id: 'acct-uuid',
  name: 'Checking',
  type: 'depository',
  mask: '0001',
};

describe('POST /api/plaid/exchange', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    mockAuth.mockResolvedValue({ userId: null });
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(401);
  });

  it('returns 400 when body is missing required fields', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    const res = await POST(makeRequest({ publicToken: 'tok' })); // missing institutionId/Name
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    const req = new Request('http://localhost/api/plaid/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 when user row does not exist', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(undefined);
    const res = await POST(makeRequest(validBody));
    expect(res.status).toBe(404);
  });

  it('happy path: returns itemId and accounts, writes audit event', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(mockUser);
    mockExchange.mockResolvedValue({ data: { access_token: 'access-sandbox-xyz' } });
    mockEncrypt.mockResolvedValue('encrypted-token');
    mockInsertItem.mockResolvedValue(mockItem);
    mockAccountsGet.mockResolvedValue({ data: { accounts: [mockPlaidAccount] } });
    mockUpsertAccount.mockResolvedValue(mockSavedAccount);
    mockInsertAudit.mockResolvedValue({});

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(200);
    const body = await res.json() as { itemId: string; accounts: unknown[] };
    expect(body.itemId).toBe('item-uuid');
    expect(body.accounts).toHaveLength(1);

    // Access token must never appear in the response.
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('access-sandbox-xyz');

    // Audit event written.
    expect(mockInsertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'plaid.connect',
        source: 'user',
        entityId: 'item-uuid',
      }),
    );

    // encryptSecret called with raw token.
    expect(mockEncrypt).toHaveBeenCalledWith('access-sandbox-xyz');

    // Encrypted value (not raw token) stored.
    expect(mockInsertItem).toHaveBeenCalledWith(
      expect.objectContaining({ accessTokenEnc: 'encrypted-token' }),
    );
  });

  it('returns 500 when accountsGet fails after successful exchange (access token must not leak)', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(mockUser);
    mockExchange.mockResolvedValue({ data: { access_token: 'access-sandbox-secret' } });
    mockEncrypt.mockResolvedValue('encrypted-token');
    mockInsertItem.mockResolvedValue(mockItem);
    mockAccountsGet.mockRejectedValue(new Error('Plaid accountsGet failed'));

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(500);
    const bodyText = await res.text();
    expect(bodyText).not.toContain('access-sandbox-secret');
  });

  it('returns 500 when insertAuditEvent fails (access token must not leak)', async () => {
    mockAuth.mockResolvedValue({ userId: 'clerk_abc' });
    mockFindUser.mockResolvedValue(mockUser);
    mockExchange.mockResolvedValue({ data: { access_token: 'access-sandbox-secret' } });
    mockEncrypt.mockResolvedValue('encrypted-token');
    mockInsertItem.mockResolvedValue(mockItem);
    mockAccountsGet.mockResolvedValue({ data: { accounts: [mockPlaidAccount] } });
    mockUpsertAccount.mockResolvedValue(mockSavedAccount);
    mockInsertAudit.mockRejectedValue(new Error('DB error'));

    const res = await POST(makeRequest(validBody));

    expect(res.status).toBe(500);
    const bodyText = await res.text();
    expect(bodyText).not.toContain('access-sandbox-secret');
  });
});
