import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { importJWK, jwtVerify } from 'jose';
import { z } from 'zod';
import { plaidClient } from '@/lib/plaid';
import { inngest } from '@/lib/inngest';
import { getPlaidItemByPlaidItemId } from '@/db/queries/plaid-items';

// ---------------------------------------------------------------------------
// POST /api/plaid/webhook
//
// Receives signed webhook notifications from Plaid. Verification flow:
//   1. Read raw body as text (must happen before any JSON parse).
//   2. Extract Plaid-Verification JWT header; decode kid without verifying.
//   3. Fetch the JWK for that kid from Plaid (with a simple in-process cache).
//   4. Verify the JWT signature using the JWK.
//   5. Compare request_body_sha256 claim against SHA-256(raw body).
//   6. Parse and dispatch on webhook_type / webhook_code.
//
// On TRANSACTIONS_SYNC_UPDATES_AVAILABLE, enqueue a plaid/item.sync
// Inngest event. All other event types are acknowledged without action.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Plaid webhook body schema — only the fields we act on.
// ---------------------------------------------------------------------------

const PlaidWebhookBody = z.object({
  webhook_type: z.string(),
  webhook_code: z.string(),
  item_id: z.string(),
  error: z
    .object({
      error_code: z.string(),
      error_type: z.string(),
      display_message: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

// ---------------------------------------------------------------------------
// Minimal JWT header shape for extracting kid before full verification.
// ---------------------------------------------------------------------------

const JwtHeader = z.object({
  alg: z.string(),
  kid: z.string(),
});

// ---------------------------------------------------------------------------
// Simple in-process key cache: kid → imported CryptoKey.
// Keys are cached until Plaid marks them as expired (expired_at != null and
// expired_at is in the past). In serverless environments this cache is
// per-invocation, which is acceptable — it avoids repeat Plaid API calls
// within a single cold start handling multiple events.
// ---------------------------------------------------------------------------

interface CachedKey {
  cryptoKey: CryptoKey;
  expiredAt: number | null;
}
const keyCache = new Map<string, CachedKey>();

async function fetchVerificationKey(kid: string): Promise<CryptoKey> {
  const cached = keyCache.get(kid);
  const nowSec = Math.floor(Date.now() / 1000);
  if (cached && (cached.expiredAt === null || cached.expiredAt > nowSec)) {
    return cached.cryptoKey;
  }

  const res = await plaidClient.webhookVerificationKeyGet({ key_id: kid });
  const jwk = res.data.key;

  if (jwk.expired_at !== null && jwk.expired_at !== undefined && jwk.expired_at <= nowSec) {
    throw new Error(`Plaid verification key ${kid} is expired`);
  }

  // jose expects a standard JWK object (without Plaid-specific fields).
  const cryptoKey = await importJWK(
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, alg: jwk.alg },
    jwk.alg,
  );

  // cast: importJWK returns KeyLike which is CryptoKey in Node.js ≥ 16
  keyCache.set(kid, { cryptoKey: cryptoKey as CryptoKey, expiredAt: jwk.expired_at ?? null });
  return cryptoKey as CryptoKey;
}

// ---------------------------------------------------------------------------
// JWT payload shape produced by Plaid.
// ---------------------------------------------------------------------------

const PlaidJwtPayload = z.object({
  request_body_sha256: z.string(),
  iat: z.number(),
});

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  // 1. Read raw body first — json() / formData() would consume the stream.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: 'Failed to read body' }, { status: 400 });
  }

  // 2. Extract and decode Plaid-Verification JWT (header only, no signature check yet).
  const jwtToken = request.headers.get('Plaid-Verification');
  if (!jwtToken) {
    return NextResponse.json({ error: 'Missing Plaid-Verification header' }, { status: 400 });
  }

  const jwtParts = jwtToken.split('.');
  if (jwtParts.length !== 3) {
    return NextResponse.json({ error: 'Malformed JWT' }, { status: 400 });
  }

  let kid: string;
  try {
    // Base64url-decode the header segment (first part).
    const headerJson = Buffer.from(jwtParts[0] ?? '', 'base64url').toString('utf8');
    const headerParsed = JwtHeader.parse(JSON.parse(headerJson) as unknown);
    kid = headerParsed.kid;
  } catch {
    return NextResponse.json({ error: 'Invalid JWT header' }, { status: 400 });
  }

  // 3. Fetch / cache the Plaid verification key.
  let verificationKey: CryptoKey;
  try {
    verificationKey = await fetchVerificationKey(kid);
  } catch {
    return NextResponse.json({ error: 'Failed to fetch verification key' }, { status: 400 });
  }

  // 4. Verify the JWT signature and parse the payload.
  let jwtPayload: z.infer<typeof PlaidJwtPayload>;
  try {
    const { payload } = await jwtVerify(jwtToken, verificationKey);
    jwtPayload = PlaidJwtPayload.parse(payload);
  } catch {
    return NextResponse.json({ error: 'Invalid JWT signature' }, { status: 400 });
  }

  // 5. Verify the body hash matches the claim in the JWT.
  const expectedHash = jwtPayload.request_body_sha256;
  const actualHash = createHash('sha256').update(rawBody).digest('hex');
  if (actualHash !== expectedHash) {
    return NextResponse.json({ error: 'Body hash mismatch' }, { status: 400 });
  }

  // 6. Parse webhook body.
  let webhook: z.infer<typeof PlaidWebhookBody>;
  try {
    webhook = PlaidWebhookBody.parse(JSON.parse(rawBody) as unknown);
  } catch {
    return NextResponse.json({ error: 'Invalid webhook body' }, { status: 400 });
  }

  // 7. Dispatch on webhook type.
  try {
    if (
      webhook.webhook_type === 'TRANSACTIONS' &&
      webhook.webhook_code === 'SYNC_UPDATES_AVAILABLE'
    ) {
      const item = await getPlaidItemByPlaidItemId(webhook.item_id);
      if (item) {
        await inngest.send({
          name: 'plaid/item.sync',
          data: { itemId: item.id },
        });
      }
      // If item is not found (e.g. it was disconnected between the webhook
      // being sent and us receiving it), acknowledge without error — Plaid
      // must not retry based on our 4xx.
    }
    // All other webhook types are acknowledged without action for now.
  } catch {
    // DB or Inngest errors should produce a 500 so Plaid retries.
    return NextResponse.json({ error: 'Internal error processing webhook' }, { status: 500 });
  }

  return new Response(null, { status: 200 });
}
