import { and, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { netWorthSnapshots } from '@/db/schema';
import type { NetWorthSnapshotId, UserId } from '@/shared/types';

export type NetWorthSnapshotRow = typeof netWorthSnapshots.$inferSelect;
export type NewNetWorthSnapshot = typeof netWorthSnapshots.$inferInsert;

export type NetWorthRange = '30d' | '90d' | '1y';

export type NetWorthPoint = {
  /** UTC date string (YYYY-MM-DD). */
  readonly date: string;
  readonly assetsCents: bigint;
  readonly liabilitiesCents: bigint;
  /** Net worth = assets − liabilities. */
  readonly netWorthCents: bigint;
};

/**
 * Return daily net worth points for the given range, ordered ascending by date.
 * Used for sparklines and trend charts on the Net Worth dashboard.
 *
 * @param range - '30d' (last 30 days), '90d' (last 90 days), '1y' (last 365 days)
 */
export async function getNetWorthSeries(
  userId: UserId,
  range: NetWorthRange,
): Promise<NetWorthPoint[]> {
  const daysMap: Record<NetWorthRange, number> = { '30d': 30, '90d': 90, '1y': 365 };
  const days = daysMap[range];

  // Compute start date as YYYY-MM-DD string (UTC).
  const startDate = new Date();
  startDate.setUTCDate(startDate.getUTCDate() - days);
  const startDateStr = startDate.toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);

  const rows = await db
    .select()
    .from(netWorthSnapshots)
    .where(
      and(
        eq(netWorthSnapshots.userId, userId),
        gte(netWorthSnapshots.snapshotDate, startDateStr),
        lte(netWorthSnapshots.snapshotDate, todayStr),
      ),
    )
    .orderBy(netWorthSnapshots.snapshotDate);

  return rows.map((r) => ({
    date: r.snapshotDate,
    assetsCents: r.assetsCents,
    liabilitiesCents: r.liabilitiesCents,
    netWorthCents: r.assetsCents - r.liabilitiesCents,
  }));
}

/**
 * Fetch the most recent net worth snapshot for a user.
 * Returns undefined if no snapshots exist yet.
 */
export async function getLatestNetWorthSnapshot(
  userId: UserId,
): Promise<NetWorthSnapshotRow | undefined> {
  const rows = await db
    .select()
    .from(netWorthSnapshots)
    .where(eq(netWorthSnapshots.userId, userId))
    .orderBy(sql`${netWorthSnapshots.snapshotDate} desc`)
    .limit(1);
  return rows[0];
}

/**
 * Upsert a daily net worth snapshot.
 * On conflict (same user + date), refreshes assets, liabilities, and breakdown.
 * Idempotent — the nightly Inngest job can safely re-run for the same date.
 */
export async function upsertNetWorthSnapshot(
  input: NewNetWorthSnapshot,
): Promise<NetWorthSnapshotRow> {
  const rows = await db
    .insert(netWorthSnapshots)
    .values(input)
    .onConflictDoUpdate({
      target: [netWorthSnapshots.userId, netWorthSnapshots.snapshotDate],
      set: {
        assetsCents: input.assetsCents,
        liabilitiesCents: input.liabilitiesCents,
        breakdown: input.breakdown,
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('upsertNetWorthSnapshot: no row returned');
  return row;
}

/**
 * Fetch the set of dates that already have snapshots within a date range.
 * Used by the backfill logic to identify gap days.
 */
export async function getSnapshotDatesBetween(
  userId: UserId,
  startDate: string,
  endDate: string,
): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ snapshotDate: netWorthSnapshots.snapshotDate })
    .from(netWorthSnapshots)
    .where(
      and(
        eq(netWorthSnapshots.userId, userId),
        gte(netWorthSnapshots.snapshotDate, startDate),
        lte(netWorthSnapshots.snapshotDate, endDate),
      ),
    );
  return new Set(rows.map((r) => r.snapshotDate));
}

// Re-export for callers that import branded types alongside queries.
export type { NetWorthSnapshotId };
