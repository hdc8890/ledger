import { createHash } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — mock factories must be defined before vi.mock calls.
// ---------------------------------------------------------------------------

const {
  mockWebhookVerificationKeyGet,
  mockGetPlaidItemByPlaidItemId,
  mockInngestSend,
  mockImportJWK,
  mockJwtVerify,
} = vi.hoisted(() => {
  const mockWebhookVerificationKeyGet = vi.fn();
  const mockGetPlaidItemByPlaidItemId = vi.fn();
  const mockInngestSend = vi.fn();
  const mockImportJWK = vi.fn();
  const mockJwtVerify = vi.fn();
  return {
    mockWebhookVerificationKeyGet,
    mockGetPlaidItemByPlaidItemId,
    mockInngestSend,
    mockImportJWK,
    mockJwtVerify,
  };
});

vi.mock('@/lib/plaid', () => ({
  plaidClient: { webhookVerificationKeyGet: mockWebhookVerificationKeyGet },
}));

vi.mock('@/db/queries/plaid-items', () => ({
  getPlaidItemByPlaidItemId: mockGetPlaidItemByPlaidItemId,
}));

vi.mock('@/lib/inngest', () => ({
  inngest: { send: mockInngestSend },
}));

vi.mock('jose', () => ({
  importJWK: mockImportJWK,
  jwtVerify: mockJwtVerify,
}));

import { POST } from '../route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_CRYPTO_KEY = {} as CryptoKey;

const MOCK_JWK = {
  alg: 'ES256',
  crv: 'P-256',
  kid: 'test-kid',
  kty: 'EC',
  use: 'sig',
  x: 'abc',
  y: 'def',
  created_at: 1700000000,
  expired_at: null,
};

function makeBodyWithHash(body: string): { jwt: string; rawBody: string } {
  const hash = createHash('sha256').update(body).digest('hex');
  const jwtHeaderStr = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'test-kid' })).toString(
    'base64url',
  );
  const jwtPayloadStr = Buffer.from(
    JSON.stringify({ request_body_sha256: hash, iat: 1700000000 }),
  ).toString('base64url');
  return {
    jwt: `${jwtHeaderStr}.${jwtPayloadStr}.signature`,
    rawBody: body,
  };
}

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/plaid/webhook', {
    method: 'POST',
    headers,
    body,
  });
}

const syncAvailableBody = JSON.stringify({
  webhook_type: 'TRANSACTIONS',
  webhook_code: 'SYNC_UPDATES_AVAILABLE',
  item_id: 'plaid-item-id-1',
  error: null,
});

const mockItem = {
  id: 'internal-item-uuid',
  plaidItemId: 'plaid-item-id-1',
  userId: 'user-uuid',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/plaid/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: key fetch returns the mock JWK; importJWK returns a fake CryptoKey.
    mockWebhookVerificationKeyGet.mockResolvedValue({ data: { key: MOCK_JWK } });
    mockImportJWK.mockResolvedValue(FAKE_CRYPTO_KEY);
  });

  it('returns 400 when Plaid-Verification header is absent', async () => {
    const req = makeRequest('{}');
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when JWT is malformed (not three parts)', async () => {
    const req = makeRequest('{}', { 'Plaid-Verification': 'notajwt' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when JWT header cannot be base64url-decoded', async () => {
    const req = makeRequest('{}', { 'Plaid-Verification': '!!!.payload.sig' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when verification key fetch fails', async () => {
    mockWebhookVerificationKeyGet.mockRejectedValue(new Error('Plaid API error'));
    const { jwt, rawBody } = makeBodyWithHash('{}');
    const req = makeRequest(rawBody, { 'Plaid-Verification': jwt });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when JWT signature verification fails', async () => {
    mockJwtVerify.mockRejectedValue(new Error('invalid signature'));
    const { jwt, rawBody } = makeBodyWithHash('{}');
    const req = makeRequest(rawBody, { 'Plaid-Verification': jwt });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when body hash does not match JWT claim', async () => {
    const { jwt } = makeBodyWithHash('original body');
    // Tampered body differs from what was signed.
    mockJwtVerify.mockResolvedValue({
      payload: {
        request_body_sha256: createHash('sha256').update('original body').digest('hex'),
        iat: 1700000000,
      },
    });

    const req = makeRequest('tampered body', { 'Plaid-Verification': jwt });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 200 and ignores unhandled webhook types', async () => {
    const body = JSON.stringify({
      webhook_type: 'AUTH',
      webhook_code: 'AUTOMATICALLY_VERIFIED',
      item_id: 'plaid-item-id-1',
    });
    const hash = createHash('sha256').update(body).digest('hex');
    mockJwtVerify.mockResolvedValue({
      payload: { request_body_sha256: hash, iat: 1700000000 },
    });

    const jwtHeaderStr = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'test-kid' })).toString(
      'base64url',
    );
    const jwtPayloadStr = Buffer.from(
      JSON.stringify({ request_body_sha256: hash, iat: 1700000000 }),
    ).toString('base64url');
    const jwt = `${jwtHeaderStr}.${jwtPayloadStr}.signature`;

    const req = makeRequest(body, { 'Plaid-Verification': jwt });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('happy path: TRANSACTIONS/SYNC_UPDATES_AVAILABLE enqueues inngest event', async () => {
    const { jwt, rawBody } = makeBodyWithHash(syncAvailableBody);
    const hash = createHash('sha256').update(syncAvailableBody).digest('hex');

    mockJwtVerify.mockResolvedValue({
      payload: { request_body_sha256: hash, iat: 1700000000 },
    });
    mockGetPlaidItemByPlaidItemId.mockResolvedValue(mockItem);
    mockInngestSend.mockResolvedValue({ ids: ['event-id-1'] });

    const req = makeRequest(rawBody, { 'Plaid-Verification': jwt });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockGetPlaidItemByPlaidItemId).toHaveBeenCalledWith('plaid-item-id-1');
    expect(mockInngestSend).toHaveBeenCalledWith({
      name: 'plaid/item.sync',
      data: { itemId: 'internal-item-uuid' },
    });
  });

  it('returns 200 without firing inngest when item_id is not in DB (already disconnected)', async () => {
    const { jwt, rawBody } = makeBodyWithHash(syncAvailableBody);
    const hash = createHash('sha256').update(syncAvailableBody).digest('hex');

    mockJwtVerify.mockResolvedValue({
      payload: { request_body_sha256: hash, iat: 1700000000 },
    });
    mockGetPlaidItemByPlaidItemId.mockResolvedValue(undefined);

    const req = makeRequest(rawBody, { 'Plaid-Verification': jwt });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('returns 500 when inngest.send fails so Plaid retries the webhook', async () => {
    const { jwt, rawBody } = makeBodyWithHash(syncAvailableBody);
    const hash = createHash('sha256').update(syncAvailableBody).digest('hex');

    mockJwtVerify.mockResolvedValue({
      payload: { request_body_sha256: hash, iat: 1700000000 },
    });
    mockGetPlaidItemByPlaidItemId.mockResolvedValue(mockItem);
    mockInngestSend.mockRejectedValue(new Error('Inngest unavailable'));

    const req = makeRequest(rawBody, { 'Plaid-Verification': jwt });
    const res = await POST(req);

    expect(res.status).toBe(500);
  });

  it('returns 500 when DB lookup fails so Plaid retries the webhook', async () => {
    const { jwt, rawBody } = makeBodyWithHash(syncAvailableBody);
    const hash = createHash('sha256').update(syncAvailableBody).digest('hex');

    mockJwtVerify.mockResolvedValue({
      payload: { request_body_sha256: hash, iat: 1700000000 },
    });
    mockGetPlaidItemByPlaidItemId.mockRejectedValue(new Error('DB error'));

    const req = makeRequest(rawBody, { 'Plaid-Verification': jwt });
    const res = await POST(req);

    expect(res.status).toBe(500);
  });
});
