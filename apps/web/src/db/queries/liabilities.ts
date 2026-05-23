import { eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { liabilities } from '@/db/schema';
import type { AccountId, LiabilityId, UserId } from '@/shared/types';

export type LiabilityRow = typeof liabilities.$inferSelect;
export type NewLiability = typeof liabilities.$inferInsert;

export type DebtSummary = {
  readonly totalBalanceCents: bigint;
  /** Sum of estimated monthly minimums (uses simple interest estimate: balance × apr / 12). Null when APR is unknown for all liabilities. */
  readonly estimatedMonthlyMinimumCents: bigint | null;
  readonly byKind: ReadonlyArray<{
    readonly kind: LiabilityRow['kind'];
    readonly totalCents: bigint;
    readonly count: number;
  }>;
};

/**
 * Fetch all liabilities for a user.
 */
export async function getLiabilitiesByUserId(userId: UserId): Promise<LiabilityRow[]> {
  return db.select().from(liabilities).where(eq(liabilities.userId, userId));
}

/**
 * Fetch a single liability by internal UUID. Returns undefined if not found.
 */
export async function getLiabilityById(id: LiabilityId): Promise<LiabilityRow | undefined> {
  const rows = await db.select().from(liabilities).where(eq(liabilities.id, id)).limit(1);
  return rows[0];
}

/**
 * Return a rolled-up debt summary for the Debt dashboard:
 * total balance, estimated monthly minimum, and per-kind breakdown.
 *
 * Monthly minimum estimate: balance_cents × (apr / 12), computed in PostgreSQL
 * floating-point before casting to bigint. This is intentionally approximate —
 * actual minimums vary by lender and the result is labelled "floor estimate".
 */
export async function getDebtSummary(userId: UserId): Promise<DebtSummary> {
  const [totals, byKindRows] = await Promise.all([
    db
      .select({
        totalBalanceCents: sql<string>`sum(${liabilities.balanceCents})`,
        estimatedMonthlyMinimumCents: sql<string | null>`
          sum(
            case
              when ${liabilities.apr} is not null
              then (${liabilities.balanceCents} * ${liabilities.apr} / 12.0)::bigint
              else null
            end
          )`,
      })
      .from(liabilities)
      .where(eq(liabilities.userId, userId)),
    db
      .select({
        kind: liabilities.kind,
        totalCents: sql<string>`sum(${liabilities.balanceCents})`,
        count: sql<number>`count(*)::int`,
      })
      .from(liabilities)
      .where(eq(liabilities.userId, userId))
      .groupBy(liabilities.kind),
  ]);

  const row = totals[0];
  return {
    totalBalanceCents: BigInt(row?.totalBalanceCents ?? '0'),
    estimatedMonthlyMinimumCents:
      row?.estimatedMonthlyMinimumCents != null
        ? BigInt(row.estimatedMonthlyMinimumCents)
        : null,
    byKind: byKindRows.map((r) => ({
      kind: r.kind,
      totalCents: BigInt(r.totalCents ?? '0'),
      count: r.count,
    })),
  };
}

/**
 * Insert a new liability row. Returns the created row.
 */
export async function insertLiability(input: NewLiability): Promise<LiabilityRow> {
  const rows = await db.insert(liabilities).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('insertLiability: no row returned');
  return row;
}

/**
 * Update mutable fields of an existing liability.
 * Returns the updated row, or undefined if the liability was not found.
 */
export async function updateLiability(
  id: LiabilityId,
  patch: Partial<
    Pick<
      LiabilityRow,
      | 'name'
      | 'balanceCents'
      | 'apr'
      | 'termMonths'
      | 'originalPrincipalCents'
      | 'accountId'
      | 'metadata'
    >
  >,
): Promise<LiabilityRow | undefined> {
  const rows = await db
    .update(liabilities)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(liabilities.id, id))
    .returning();
  return rows[0];
}

/**
 * Upsert a liability keyed on accountId (for Plaid-synced liabilities).
 * On conflict with the same accountId, refreshes balance and updated_at.
 * Idempotent — safe to call on every sync.
 *
 * Requires: input.accountId must be non-null (enforced by partial unique index
 * liabilities_account_id_uniq). Throws if accountId is absent.
 */
export async function upsertLiabilityByAccountId(input: NewLiability): Promise<LiabilityRow> {
  if (input.accountId == null) {
    throw new Error('upsertLiabilityByAccountId: accountId must be non-null');
  }
  const rows = await db
    .insert(liabilities)
    .values(input)
    .onConflictDoUpdate({
      target: liabilities.accountId as unknown as typeof liabilities.accountId,
      set: {
        balanceCents: input.balanceCents,
        updatedAt: new Date(),
      },
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error('upsertLiabilityByAccountId: no row returned');
  return row;
}

/**
 * Hard-delete a liability.
 */
export async function deleteLiability(id: LiabilityId): Promise<void> {
  await db.delete(liabilities).where(eq(liabilities.id, id));
}

// Re-export for convenience in callers that only need the AccountId import.
export type { AccountId };
