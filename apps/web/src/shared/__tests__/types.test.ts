import { describe, it, expect } from 'vitest';
import { brand, type UserId, type AccountId } from '../types';

describe('brand', () => {
  it('passes the underlying string value through unchanged', () => {
    const raw = 'user-abc-123';
    const id = brand<UserId>(raw);
    expect(id).toBe(raw);
  });

  it('produces distinct nominal types that still share runtime representation', () => {
    const userId = brand<UserId>('u1');
    const accountId = brand<AccountId>('a1');
    expect(typeof userId).toBe('string');
    expect(typeof accountId).toBe('string');
    expect(userId).not.toBe(accountId);
  });
});
