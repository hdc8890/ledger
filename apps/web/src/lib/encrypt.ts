/**
 * Symmetric encryption helpers for sensitive secrets (e.g. Plaid access tokens).
 *
 * Algorithm: libsodium XSalsa20-Poly1305 (crypto_secretbox_easy).
 * A fresh random nonce is generated per encryption and prepended to the
 * ciphertext so each blob is self-contained. The result is base64-encoded.
 *
 * Key material comes from ENCRYPTION_KEY (base64-encoded 32-byte key).
 * Generate one with: `node -e "require('crypto').randomBytes(32).toString('base64')|console.log"`
 */

import _sodium from 'libsodium-wrappers';

async function ready(): Promise<typeof _sodium> {
  await _sodium.ready;
  return _sodium;
}

function keyFromEnv(sodium: typeof _sodium): Uint8Array {
  const b64 = process.env['ENCRYPTION_KEY'];
  if (!b64) throw new Error('ENCRYPTION_KEY env var is not set');
  // Wrap in new Uint8Array() to ensure the instance belongs to the current
  // realm — necessary in test environments (jsdom) where cross-realm
  // Uint8Array instances fail libsodium's instanceof checks.
  const key = new Uint8Array(sodium.from_base64(b64, sodium.base64_variants.ORIGINAL));
  if (key.length !== sodium.crypto_secretbox_KEYBYTES) {
    throw new Error(
      `ENCRYPTION_KEY must be ${String(sodium.crypto_secretbox_KEYBYTES)} bytes; got ${String(key.length)}`,
    );
  }
  return key;
}

/**
 * Encrypt a plaintext string.
 * Returns a base64-encoded blob of (nonce || ciphertext).
 * Safe to store in the database; never log the return value of decryptSecret.
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  const sodium = await ready();
  const key = keyFromEnv(sodium);
  const nonce = new Uint8Array(sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES));
  const msg = new Uint8Array(sodium.from_string(plaintext));
  const cipher = new Uint8Array(sodium.crypto_secretbox_easy(msg, nonce, key));

  const combined = new Uint8Array(nonce.length + cipher.length);
  combined.set(nonce);
  combined.set(cipher, nonce.length);

  return sodium.to_base64(combined, sodium.base64_variants.ORIGINAL);
}

/**
 * Decrypt a blob produced by encryptSecret.
 * Throws if the blob is tampered with or the key is wrong.
 */
export async function decryptSecret(encoded: string): Promise<string> {
  const sodium = await ready();
  const key = keyFromEnv(sodium);
  const combined = new Uint8Array(sodium.from_base64(encoded, sodium.base64_variants.ORIGINAL));

  const nonceLen = sodium.crypto_secretbox_NONCEBYTES;
  if (combined.length <= nonceLen) {
    throw new Error('decryptSecret: encoded blob is too short');
  }

  const nonce = new Uint8Array(combined.slice(0, nonceLen));
  const cipher = new Uint8Array(combined.slice(nonceLen));
  const plaintext = sodium.crypto_secretbox_open_easy(cipher, nonce, key);

  return sodium.to_string(plaintext);
}
