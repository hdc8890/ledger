import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptSecret, decryptSecret } from '../encrypt';

// A valid 32-byte key encoded in base64.
const TEST_KEY = Buffer.alloc(32, 0xab).toString('base64');

describe('encryptSecret / decryptSecret', () => {
  beforeEach(() => {
    process.env['ENCRYPTION_KEY'] = TEST_KEY;
  });

  afterEach(() => {
    delete process.env['ENCRYPTION_KEY'];
  });

  it('roundtrip: decrypting an encrypted value yields the original plaintext', async () => {
    const plaintext = 'access-sandbox-abc123-token';
    const encoded = await encryptSecret(plaintext);
    const result = await decryptSecret(encoded);
    expect(result).toBe(plaintext);
  });

  it('produces different ciphertexts for the same plaintext (random nonce)', async () => {
    const plaintext = 'same-secret';
    const enc1 = await encryptSecret(plaintext);
    const enc2 = await encryptSecret(plaintext);
    expect(enc1).not.toBe(enc2);
  });

  it('throws when ENCRYPTION_KEY is not set', async () => {
    delete process.env['ENCRYPTION_KEY'];
    await expect(encryptSecret('x')).rejects.toThrow('ENCRYPTION_KEY');
  });

  it('throws when decrypting a tampered blob', async () => {
    const encoded = await encryptSecret('secret');
    const bytes = Buffer.from(encoded, 'base64');
    // Flip the last byte to tamper.
    const lastIdx = bytes.length - 1;
    const lastByte = bytes[lastIdx];
    if (lastIdx >= 0 && lastByte !== undefined) bytes[lastIdx] = lastByte ^ 0xff;
    const tampered = bytes.toString('base64');
    await expect(decryptSecret(tampered)).rejects.toThrow();
  });
});
