import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { findUserByClerkId } from '@/db/queries/users';
import { getAssetsByUserId } from '@/db/queries/assets';
import { getSnapshotNearDate, parseSnapshotBreakdown } from '@/db/queries/net-worth';
import { AssetKindCard } from '@/components/assets/asset-kind-card';
import { AssetsEmptyState } from '@/components/assets/empty-state';
import type { UserId } from '@/shared/types';
import type { AssetRow } from '@/db/queries/assets';

const KIND_LABELS: Record<string, string> = {
  home: 'Home',
  vehicle: 'Vehicles',
  brokerage: 'Brokerage',
  cash: 'Cash',
  crypto: 'Crypto',
  manual: 'Manual',
};

/** Order in which asset kinds are displayed. */
const KIND_ORDER: readonly string[] = [
  'home',
  'vehicle',
  'brokerage',
  'cash',
  'crypto',
  'manual',
];

function utcDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default async function AssetsPage() {
  const { userId: clerkId } = await auth();
  if (!clerkId) redirect('/sign-in');

  const user = await findUserByClerkId(clerkId);
  if (!user) redirect('/sign-in');

  const userId = user.id as UserId;

  const date30dAgo = utcDaysAgo(30);
  const date1yAgo = utcDaysAgo(365);

  const [assets, snapshot30d, snapshot1y] = await Promise.all([
    getAssetsByUserId(userId),
    getSnapshotNearDate(userId, date30dAgo),
    getSnapshotNearDate(userId, date1yAgo),
  ]);

  if (assets.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Assets</h1>
          <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
            Home, vehicles, brokerage, and other assets.
          </p>
        </div>
        <AssetsEmptyState />
      </div>
    );
  }

  // Group assets by kind.
  const byKind = new Map<string, AssetRow[]>();
  for (const asset of assets) {
    const list = byKind.get(asset.kind) ?? [];
    list.push(asset);
    byKind.set(asset.kind, list);
  }

  // Current totals per kind.
  const currentTotals = new Map<string, bigint>();
  for (const [kind, kindAssets] of byKind) {
    currentTotals.set(kind, kindAssets.reduce((sum, a) => sum + a.valueCents, 0n));
  }

  const breakdown30d = parseSnapshotBreakdown(snapshot30d?.breakdown);
  const breakdown1y = parseSnapshotBreakdown(snapshot1y?.breakdown);

  // Render kinds in canonical order, followed by any remaining kinds.
  const orderedKinds = [
    ...KIND_ORDER.filter((k) => byKind.has(k)),
    ...[...byKind.keys()].filter((k) => !KIND_ORDER.includes(k)),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Assets</h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          Home, vehicles, brokerage, and other assets.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {orderedKinds.map((kind) => {
          const kindAssets = byKind.get(kind) ?? [];
          const totalCents = currentTotals.get(kind) ?? 0n;
          const prev30d = breakdown30d[kind];
          const prev1y = breakdown1y[kind];

          return (
            <AssetKindCard
              key={kind}
              label={KIND_LABELS[kind] ?? kind}
              totalCents={totalCents}
              delta30dCents={prev30d != null ? totalCents - prev30d : null}
              delta1yCents={prev1y != null ? totalCents - prev1y : null}
              assets={kindAssets}
            />
          );
        })}
      </div>
    </div>
  );
}

