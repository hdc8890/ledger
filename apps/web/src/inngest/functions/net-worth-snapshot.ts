import { inngest } from '@/lib/inngest';
import { getAllUsers } from '@/db/queries/users';
import { getAssetBreakdown } from '@/db/queries/assets';
import { getDebtSummary } from '@/db/queries/liabilities';
import {
  getLatestNetWorthSnapshot,
  getSnapshotDatesBetween,
  upsertNetWorthSnapshot,
} from '@/db/queries/net-worth';
import type { UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Core handler — exported for unit testing
// ---------------------------------------------------------------------------

export type NetWorthSnapshotContext = {
  step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
};

export type NetWorthSnapshotResult = {
  usersProcessed: number;
  usersFailed: number;
  snapshotsCreated: number;
};

/**
 * Compute and upsert today's net worth snapshot for a single user.
 * Also backfills any gap days (days since last snapshot) with the
 * current asset/liability values. This handles recovery from missed
 * job runs — exact historical values aren't available so current values
 * are used as a best approximation.
 *
 * Returns the number of snapshot rows upserted (today + any gap days).
 */
export async function computeAndUpsertSnapshot(userId: UserId): Promise<number> {
  const todayStr = new Date().toISOString().slice(0, 10);

  const [breakdown, debtSummary, latestSnapshot] = await Promise.all([
    getAssetBreakdown(userId),
    getDebtSummary(userId),
    getLatestNetWorthSnapshot(userId),
  ]);

  const totalAssets = breakdown.reduce((sum, b) => sum + b.totalCents, 0n);
  const totalLiabilities = debtSummary.totalBalanceCents;

  // Serialize breakdown values as strings for JSON storage (bigint-safe).
  const breakdownJson: Record<string, string> = {};
  for (const b of breakdown) {
    breakdownJson[b.kind] = b.totalCents.toString();
  }

  // Determine which dates need a snapshot (today + gap days).
  const datesToUpsert: string[] = [];

  if (latestSnapshot) {
    const lastDate = latestSnapshot.snapshotDate;
    if (lastDate < todayStr) {
      // Find gap dates between last snapshot (exclusive) and today (inclusive).
      const existingDates = await getSnapshotDatesBetween(userId, lastDate, todayStr);
      const cursor = new Date(lastDate + 'T00:00:00Z');
      cursor.setUTCDate(cursor.getUTCDate() + 1);

      while (cursor.toISOString().slice(0, 10) <= todayStr) {
        const d = cursor.toISOString().slice(0, 10);
        if (!existingDates.has(d)) {
          datesToUpsert.push(d);
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }
    // If last snapshot is already today, datesToUpsert is empty and we
    // fall through to the upsert below (idempotent).
    if (!datesToUpsert.includes(todayStr)) {
      datesToUpsert.push(todayStr);
    }
  } else {
    // No snapshots yet — only create today's.
    datesToUpsert.push(todayStr);
  }

  await Promise.all(
    datesToUpsert.map((date) =>
      upsertNetWorthSnapshot({
        userId,
        snapshotDate: date,
        assetsCents: totalAssets,
        liabilitiesCents: totalLiabilities,
        breakdown: breakdownJson,
      }),
    ),
  );

  return datesToUpsert.length;
}

export async function handleNetWorthSnapshot(
  ctx: NetWorthSnapshotContext,
): Promise<NetWorthSnapshotResult> {
  const { step } = ctx;

  const userIds = await step.run('load-user-ids', async () => {
    const allUsers = await getAllUsers();
    return allUsers.map((u) => u.id);
  });

  let usersProcessed = 0;
  let usersFailed = 0;
  let snapshotsCreated = 0;

  for (const userId of userIds) {
    const result = await step.run(`snapshot-user-${userId}`, async () => {
      try {
        const count = await computeAndUpsertSnapshot(userId as UserId);
        return { ok: true as const, count };
      } catch {
        return { ok: false as const, count: 0 };
      }
    });

    if (result.ok) {
      usersProcessed++;
      snapshotsCreated += result.count;
    } else {
      usersFailed++;
    }
  }

  return { usersProcessed, usersFailed, snapshotsCreated };
}

// ---------------------------------------------------------------------------
// Inngest function registration
// ---------------------------------------------------------------------------

/**
 * net-worth/snapshot.daily — cron job that runs nightly at 02:00 UTC.
 *
 * Computes today's net worth (assets − liabilities) for every user and
 * upserts a row in net_worth_snapshots. If the job missed days, it
 * backfills gap dates with the current asset values.
 */
export const netWorthSnapshot = inngest.createFunction(
  {
    id: 'net-worth-snapshot-daily',
    name: 'Net Worth Daily Snapshot',
    triggers: [{ cron: '0 2 * * *' }],
  },
  handleNetWorthSnapshot,
);
