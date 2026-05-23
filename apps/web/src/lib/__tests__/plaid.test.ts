import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('plaidClient module', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env['PLAID_CLIENT_ID'] = 'test-client-id';
    process.env['PLAID_SECRET'] = 'test-secret';
    process.env['PLAID_ENV'] = 'sandbox';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('instantiates a singleton PlaidApi client when env vars are set', async () => {
    const { plaidClient } = await import('../plaid');
    expect(plaidClient).toBeDefined();
    // PlaidApi instances expose product methods like itemGet / linkTokenCreate
    expect(typeof plaidClient.linkTokenCreate).toBe('function');
  });

  it('falls back to sandbox when PLAID_ENV is unrecognised', async () => {
    process.env['PLAID_ENV'] = 'not-a-real-env';
    const { plaidClient } = await import('../plaid');
    expect(plaidClient).toBeDefined();
  });

  it('throws when PLAID_CLIENT_ID is missing', async () => {
    delete process.env['PLAID_CLIENT_ID'];
    await expect(import('../plaid')).rejects.toThrow(/PLAID_CLIENT_ID/);
  });

  it('throws when PLAID_SECRET is missing', async () => {
    delete process.env['PLAID_SECRET'];
    await expect(import('../plaid')).rejects.toThrow(/PLAID_SECRET/);
  });
});
