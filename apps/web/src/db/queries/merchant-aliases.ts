import { desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { merchantAliases } from '@/db/schema';
import type { MerchantAliasId } from '@/shared/types';

export type MerchantAliasRow = typeof merchantAliases.$inferSelect;
export type NewMerchantAlias = typeof merchantAliases.$inferInsert;

/**
 * Fetch all merchant_aliases rows ordered by priority descending (highest first).
 * The normalization service loads these once per batch and applies them in order.
 */
export async function getAllMerchantAliases(): Promise<MerchantAliasRow[]> {
  return db.select().from(merchantAliases).orderBy(desc(merchantAliases.priority));
}

/**
 * Look up a single alias by exact raw_pattern match.
 * Used to check whether a pattern already exists before inserting an AI result.
 */
export async function getMerchantAliasByPattern(
  rawPattern: string,
): Promise<MerchantAliasRow | undefined> {
  const rows = await db
    .select()
    .from(merchantAliases)
    .where(eq(merchantAliases.rawPattern, rawPattern))
    .limit(1);
  return rows[0];
}

/**
 * Insert a new merchant alias. The raw_pattern unique constraint prevents
 * duplicate entries — callers should check getMerchantAliasByPattern first
 * if a conflict would indicate a bug rather than a race.
 */
export async function insertMerchantAlias(
  input: NewMerchantAlias,
): Promise<MerchantAliasRow> {
  const rows = await db.insert(merchantAliases).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('insertMerchantAlias: no row returned');
  return row;
}

/**
 * Upsert a merchant alias by raw_pattern. On conflict, updates canonical and
 * category_hint. Used by the AI enrichment pipeline to cache normalized results
 * without failing on a duplicate pattern race condition.
 */
export async function upsertMerchantAlias(
  input: NewMerchantAlias,
): Promise<MerchantAliasRow> {
  const rows = await db
    .insert(merchantAliases)
    .values(input)
    .onConflictDoUpdate({
      target: merchantAliases.rawPattern,
      set: {
        canonical: input.canonical,
        categoryHint: input.categoryHint ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('upsertMerchantAlias: no row returned');
  return row;
}

/**
 * Fetch a single alias by its internal UUID. Returns undefined if not found.
 */
export async function getMerchantAliasById(
  id: MerchantAliasId,
): Promise<MerchantAliasRow | undefined> {
  const rows = await db
    .select()
    .from(merchantAliases)
    .where(eq(merchantAliases.id, id))
    .limit(1);
  return rows[0];
}
