import { sql, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { chatRateLimits } from '@/db/schema';
import type { UserId } from '@/shared/types';

/** Maximum requests allowed per window. */
export const RATE_LIMIT_CAP = 50;

/** Window duration expressed as a Postgres interval string. */
const WINDOW_INTERVAL = '1 hour';

/** Window duration in seconds (used for fallback retryAfterSeconds). */
const WINDOW_SECONDS = 3600;

/**
 * Result returned by checkAndConsumeRateLimit.
 * allowed: true  → request is permitted; tokensRemaining shows what's left.
 * allowed: false → bucket exhausted; retryAfterSeconds is the actual wait.
 */
export type RateLimitResult =
  | { allowed: true; tokensRemaining: number }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Atomically consume one token from the user's chat rate-limit bucket.
 *
 * Uses a single INSERT...ON CONFLICT...DO UPDATE...WHERE...RETURNING statement
 * so the operation is safe under concurrent requests without a separate SELECT.
 *
 * Token-bucket logic:
 *   - On first request: insert a row with tokens = CAP - 1 (49).
 *   - On subsequent request within the window: decrement tokens by 1.
 *   - When the window has expired (refilled_at + 1h ≤ now()): reset to CAP - 1.
 *   - The WHERE guard (tokens > 0 OR window expired) prevents the update when
 *     the bucket is exhausted and the window hasn't reset, so no row is returned
 *     in that case → caller returns 429.
 *
 * When the bucket is exhausted, a follow-up SELECT computes the exact seconds
 * remaining until the window resets so the caller can set an accurate Retry-After.
 */
export async function checkAndConsumeRateLimit(userId: UserId): Promise<RateLimitResult> {
  const rows = await db.execute<{ tokens: number; refilled_at: string }>(sql`
    INSERT INTO chat_rate_limits (user_id, tokens, refilled_at, created_at)
    VALUES (${userId}, ${RATE_LIMIT_CAP - 1}, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      tokens = CASE
        WHEN chat_rate_limits.refilled_at + INTERVAL ${WINDOW_INTERVAL} <= now()
          THEN ${RATE_LIMIT_CAP - 1}
        ELSE chat_rate_limits.tokens - 1
      END,
      refilled_at = CASE
        WHEN chat_rate_limits.refilled_at + INTERVAL ${WINDOW_INTERVAL} <= now()
          THEN now()
        ELSE chat_rate_limits.refilled_at
      END
    WHERE chat_rate_limits.tokens > 0
       OR chat_rate_limits.refilled_at + INTERVAL ${WINDOW_INTERVAL} <= now()
    RETURNING tokens, refilled_at
  `);

  // db.execute returns a NeonHttpQueryResult; spread to get a plain array.
  // `as unknown as Array<...>` — NeonHttpQueryResult is not natively indexable;
  // Array.from is the correct way to consume it.
  const rowArray = Array.from(rows as unknown as Array<{ tokens: number; refilled_at: string }>);
  const row = rowArray[0];
  if (row) {
    return { allowed: true, tokensRemaining: row.tokens };
  }

  // Bucket exhausted and window not yet expired. Fetch refilled_at to compute
  // the exact seconds the caller must wait before the bucket resets.
  const existing = await db
    .select({ refilledAt: chatRateLimits.refilledAt })
    .from(chatRateLimits)
    .where(eq(chatRateLimits.userId, userId));

  const existingRow = existing[0];
  if (existingRow) {
    const windowExpiresAt = existingRow.refilledAt.getTime() + WINDOW_SECONDS * 1000;
    const retryAfterMs = Math.max(0, windowExpiresAt - Date.now());
    return { allowed: false, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) };
  }

  // Fallback (should not happen in practice — row must exist if tokens exhausted).
  return { allowed: false, retryAfterSeconds: WINDOW_SECONDS };
}
