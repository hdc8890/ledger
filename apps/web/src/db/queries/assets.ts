import { asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { assets } from '@/db/schema';
import type { AssetId, UserId } from '@/shared/types';

export type AssetRow = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;

export type AssetBreakdown = {
  readonly kind: AssetRow['kind'];
  /** Total value for this kind in cents. */
  readonly totalCents: bigint;
  /** Number of assets of this kind. */
  readonly count: number;
};

/**
 * Fetch all assets for a user, newest first.
 */
export async function getAssetsByUserId(userId: UserId): Promise<AssetRow[]> {
  return db.select().from(assets).where(eq(assets.userId, userId)).orderBy(desc(assets.createdAt));
}

/**
 * Fetch a single asset by internal UUID. Returns undefined if not found.
 */
export async function getAssetById(id: AssetId): Promise<AssetRow | undefined> {
  const rows = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
  return rows[0];
}

/**
 * Aggregate asset values grouped by kind for a user.
 * Used by the allocation donut and the net worth calculation.
 */
export async function getAssetBreakdown(userId: UserId): Promise<AssetBreakdown[]> {
  const rows = await db
    .select({
      kind: assets.kind,
      totalCents: sql<string>`sum(${assets.valueCents})`,
      count: sql<number>`count(*)::int`,
    })
    .from(assets)
    .where(eq(assets.userId, userId))
    .groupBy(assets.kind)
    .orderBy(asc(assets.kind));

  return rows.map((r) => ({
    kind: r.kind,
    totalCents: BigInt(r.totalCents ?? '0'),
    count: r.count,
  }));
}

/**
 * Insert a new asset row. Returns the created row.
 */
export async function insertAsset(input: NewAsset): Promise<AssetRow> {
  const rows = await db.insert(assets).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('insertAsset: no row returned');
  return row;
}

/**
 * Update mutable fields of an existing asset.
 * Returns the updated row, or undefined if the asset was not found.
 */
export async function updateAsset(
  id: AssetId,
  patch: Partial<
    Pick<AssetRow, 'name' | 'valueCents' | 'source' | 'confidence' | 'manualOverride' | 'metadata'>
  >,
): Promise<AssetRow | undefined> {
  const rows = await db
    .update(assets)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(assets.id, id))
    .returning();
  return rows[0];
}

/**
 * Hard-delete an asset. Assets have no shared history so hard delete is safe.
 */
export async function deleteAsset(id: AssetId): Promise<void> {
  await db.delete(assets).where(eq(assets.id, id));
}
