import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted ensures these are defined before vi.mock factories run.
// ---------------------------------------------------------------------------
const { mockUpsert, mockVerify, mockHeaders } = vi.hoisted(() => {
  const mockUpsert = vi.fn();
  const mockVerify = vi.fn();
  const mockHeaders = vi.fn();
  return { mockUpsert, mockVerify, mockHeaders };
});

vi.mock('@/db/queries/users', () => ({ upsertUserByClerkId: mockUpsert }));

vi.mock('svix', () => ({
  Webhook: vi.fn(function (this: Record<string, unknown>) {
    return { verify: mockVerify };
  }),
}));

vi.mock('next/headers', () => ({ headers: mockHeaders }));

import { POST } from '../route';

function makeRequest(body: string, extraHeaders: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/webhooks/clerk', {
    method: 'POST',
    headers: {
      'svix-id': 'msg_123',
      'svix-timestamp': '1700000000',
      'svix-signature': 'v1,abc123',
      ...extraHeaders,
    },
    body,
  });
}

describe('POST /api/webhooks/clerk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['CLERK_WEBHOOK_SECRET'] = 'whsec_test_secret';

    // Default: headers() returns a Map-like object.
    mockHeaders.mockResolvedValue({
      get: (key: string) =>
        ({
          'svix-id': 'msg_123',
          'svix-timestamp': '1700000000',
          'svix-signature': 'v1,abc123',
        })[key] ?? null,
    });
  });

  it('returns 400 when svix headers are missing', async () => {
    mockHeaders.mockResolvedValue({ get: () => null });

    const req = makeRequest('{}');
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('returns 400 when signature verification fails', async () => {
    mockVerify.mockImplementation(() => {
      throw new Error('invalid signature');
    });

    const req = makeRequest('{}');
    const res = await POST(req);

    expect(res.status).toBe(400);
  });

  it('calls upsertUserByClerkId on user.created event', async () => {
    const event = { type: 'user.created', data: { id: 'clerk_abc' } };
    mockVerify.mockReturnValue(event);
    mockUpsert.mockResolvedValue({ id: 'uuid-1', clerkId: 'clerk_abc' });

    const req = makeRequest(JSON.stringify(event));
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith({ clerkId: 'clerk_abc' });
  });

  it('ignores unhandled event types without error', async () => {
    mockVerify.mockReturnValue({ type: 'user.updated', data: { id: 'clerk_abc' } });

    const req = makeRequest('{}');
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('returns 500 when CLERK_WEBHOOK_SECRET is not set', async () => {
    delete process.env['CLERK_WEBHOOK_SECRET'];

    const req = makeRequest('{}');
    const res = await POST(req);

    expect(res.status).toBe(500);
  });
});
