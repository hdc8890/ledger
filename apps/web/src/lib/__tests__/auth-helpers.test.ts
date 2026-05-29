import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the Auth.js singleton so importing auth-helpers never initializes
// NextAuth / the Drizzle adapter (which needs env + a DB).
const { mockAuth } = vi.hoisted(() => ({ mockAuth: vi.fn() }));
vi.mock('@/auth', () => ({ auth: mockAuth }));

import { getCurrentUserId, isEmailAllowed } from '@/lib/auth-helpers';

describe('isEmailAllowed', () => {
  const original = process.env['AUTH_ALLOWED_EMAILS'];

  afterEach(() => {
    if (original === undefined) delete process.env['AUTH_ALLOWED_EMAILS'];
    else process.env['AUTH_ALLOWED_EMAILS'] = original;
  });

  it('allows any email when the allowlist is unset', () => {
    delete process.env['AUTH_ALLOWED_EMAILS'];
    expect(isEmailAllowed('anyone@example.com')).toBe(true);
  });

  it('allows any email when the allowlist is blank', () => {
    process.env['AUTH_ALLOWED_EMAILS'] = '   ';
    expect(isEmailAllowed('anyone@example.com')).toBe(true);
  });

  it('permits listed emails case-insensitively, trimming whitespace', () => {
    process.env['AUTH_ALLOWED_EMAILS'] = ' a@example.com , B@Example.com ';
    expect(isEmailAllowed('A@example.com')).toBe(true);
    expect(isEmailAllowed('b@example.com')).toBe(true);
  });

  it('rejects emails not on the allowlist', () => {
    process.env['AUTH_ALLOWED_EMAILS'] = 'a@example.com';
    expect(isEmailAllowed('intruder@example.com')).toBe(false);
  });

  it('rejects a null/undefined email when an allowlist is configured', () => {
    process.env['AUTH_ALLOWED_EMAILS'] = 'a@example.com';
    expect(isEmailAllowed(null)).toBe(false);
    expect(isEmailAllowed(undefined)).toBe(false);
  });
});

describe('getCurrentUserId', () => {
  beforeEach(() => {
    mockAuth.mockReset();
  });

  it('returns the internal user id from the session', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-123' } });
    await expect(getCurrentUserId()).resolves.toBe('user-123');
  });

  it('returns null when there is no session', async () => {
    mockAuth.mockResolvedValue(null);
    await expect(getCurrentUserId()).resolves.toBeNull();
  });

  it('returns null when the session has no user id', async () => {
    mockAuth.mockResolvedValue({ user: {} });
    await expect(getCurrentUserId()).resolves.toBeNull();
  });
});
