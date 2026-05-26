import { and, eq, gte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { recurringSeries } from '@/db/schema';
import type { RecurringCadence } from '@/lib/enrich/recurring-series';
import type { UserId, RecurringSeriesId } from '@/shared/types';

export type RecurringSeriesRow = typeof recurringSeries.$inferSelect;
export type NewRecurringSeries = typeof recurringSeries.$inferInsert;

/**
 * Upsert a recurring series row.
 * ON CONFLICT (user_id, merchant_normalized, cadence) → update all mutable fields.
 * This makes re-running the detection job idempotent.
 */
export async function upsertRecurringSeries(
  input: Omit<NewRecurringSeries, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<RecurringSeriesId> {
  const rows = await db
    .insert(recurringSeries)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [
        recurringSeries.userId,
        recurringSeries.merchantNormalized,
        recurringSeries.cadence,
      ],
      set: {
        expectedAmountCents: sql`excluded.expected_amount_cents`,
        amountTolerancePct: sql`excluded.amount_tolerance_pct`,
        nextExpectedAt: sql`excluded.next_expected_at`,
        lastSeenAt: sql`excluded.last_seen_at`,
        confidence: sql`excluded.confidence`,
        updatedAt: new Date(),
      },
    })
    .returning({ id: recurringSeries.id });

  const row = rows[0];
  if (row === undefined) throw new Error('upsertRecurringSeries: no row returned');
  return row.id as RecurringSeriesId;
}

/**
 * Fetch all recurring series for a user.
 */
export async function getRecurringSeriesByUserId(
  userId: UserId,
): Promise<RecurringSeriesRow[]> {
  return db
    .select()
    .from(recurringSeries)
    .where(eq(recurringSeries.userId, userId))
    .orderBy(recurringSeries.merchantNormalized);
}

/**
 * Fetch recurring series with next_expected_at within the next `daysAhead` calendar days.
 * Used to surface upcoming bills in the dashboard and chat context.
 *
 * @param daysAhead  How many days ahead to look (default 30).
 */
export async function getUpcomingRecurringSeries(
  userId: UserId,
  daysAhead = 30,
): Promise<RecurringSeriesRow[]> {
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);

  return db
    .select()
    .from(recurringSeries)
    .where(
      and(
        eq(recurringSeries.userId, userId),
        gte(recurringSeries.nextExpectedAt, today),
        sql`${recurringSeries.nextExpectedAt} <= ${future}`,
      ),
    )
    .orderBy(recurringSeries.nextExpectedAt);
}

/**
 * Fetch transactions eligible for recurring detection.
 * Returns all non-transfer, non-pending, non-deleted debits with a normalized merchant,
 * ordered by merchant then date so the detection algorithm can group them in-memory.
 */
export async function getTransactionsForRecurringDetection(
  userId: UserId,
): Promise<
  {
    readonly merchantNormalized: string;
    readonly amountCents: bigint;
    readonly postedAt: string;
  }[]
> {
  const { transactions } = await import('@/db/schema');

  const rows = await db
    .select({
      merchantNormalized: transactions.merchantNormalized,
      amountCents: transactions.amountCents,
      postedAt: transactions.postedAt,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        sql`${transactions.deletedAt} IS NULL`,
        sql`${transactions.pending} = false`,
        sql`${transactions.isTransfer} = false`,
        sql`${transactions.merchantNormalized} IS NOT NULL`,
        sql`${transactions.amountCents} > 0`,
      ),
    )
    .orderBy(transactions.merchantNormalized, transactions.postedAt);

  return rows
    .filter((r): r is typeof r & { merchantNormalized: string } => r.merchantNormalized !== null)
    .map((r) => ({
      merchantNormalized: r.merchantNormalized,
      amountCents: r.amountCents,
      postedAt: r.postedAt,
    }));
}

/**
 * Fetch a single recurring series by cadence for testing and diagnostics.
 */
export async function getRecurringSeriesByMerchantAndCadence(
  userId: UserId,
  merchantNormalized: string,
  cadence: RecurringCadence,
): Promise<RecurringSeriesRow | undefined> {
  const rows = await db
    .select()
    .from(recurringSeries)
    .where(
      and(
        eq(recurringSeries.userId, userId),
        eq(recurringSeries.merchantNormalized, merchantNormalized),
        eq(recurringSeries.cadence, cadence),
      ),
    )
    .limit(1);
  return rows[0];
}
