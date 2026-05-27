import { and, eq, gte, lt, not, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { transactions, recurringSeries } from '@/db/schema';
import type { UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CategorySpendAvg = {
  readonly category: string;
  /** Average monthly spending in cents for this category. */
  readonly avgMonthlyCents: bigint;
};

export type PlannerContext = {
  /** Average monthly income in cents (positive, money in), over basedOnMonths months. */
  readonly avgIncomeCents: bigint;
  /** Average monthly spending in cents (positive, money out), over basedOnMonths months. */
  readonly avgSpendingCents: bigint;
  /** avgIncomeCents − avgSpendingCents (positive = net saver). */
  readonly currentMonthlySavingsCents: bigint;
  /** Per-category average monthly spending, descending by amount. All categories included. */
  readonly spendingByCategory: readonly CategorySpendAvg[];
  /** Total estimated monthly committed bills (recurring series), in cents. */
  readonly committedMonthlyBillsCents: bigint;
  /** Number of complete months used as the data window. */
  readonly basedOnMonths: number;
  /** Confidence based on data availability. */
  readonly confidence: 'low' | 'medium' | 'high';
  /** Start of the historical window used (YYYY-MM-DD). */
  readonly windowStart: string;
  /** End of the historical window used (exclusive, YYYY-MM-DD). */
  readonly windowEnd: string;
};

// ---------------------------------------------------------------------------
// getPlannerContext
// ---------------------------------------------------------------------------

/**
 * Compute a planner context for the user based on the last N complete
 * calendar months. Used by the propose_plan tool to ground recommendations
 * in real spend history.
 *
 * @param months  Number of complete months to average (default 3).
 */
export async function getPlannerContext(userId: UserId, months = 3): Promise<PlannerContext> {
  const now = new Date();
  // Window: [first of `months` months ago, first of current month)
  const windowEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const windowStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));

  const windowStartStr = windowStart.toISOString().slice(0, 10);
  const windowEndStr = windowEnd.toISOString().slice(0, 10);

  const baseCondition = and(
    eq(transactions.userId, userId),
    sql`${transactions.deletedAt} IS NULL`,
    not(transactions.pending),
    not(transactions.isTransfer),
    gte(transactions.postedAt, windowStartStr),
    lt(transactions.postedAt, windowEndStr),
  );

  const spendingCondition = and(baseCondition, sql`${transactions.amountCents} > 0`);
  const incomeCondition = and(baseCondition, sql`${transactions.amountCents} < 0`);

  const [spendingRows, incomeRows, categoryRows, committedCents] = await Promise.all([
    // Total spending in the window
    db
      .select({ total: sql<string>`coalesce(sum(${transactions.amountCents}), 0)` })
      .from(transactions)
      .where(spendingCondition),
    // Total income in the window (negate so it's a positive number)
    db
      .select({ total: sql<string>`coalesce(sum(${transactions.amountCents}) * -1, 0)` })
      .from(transactions)
      .where(incomeCondition),
    // Per-category totals — all categories (no LIMIT)
    db
      .select({
        category: sql<string>`coalesce(${transactions.category}, 'Uncategorized')`,
        total: sql<string>`coalesce(sum(${transactions.amountCents}), 0)`,
      })
      .from(transactions)
      .where(spendingCondition)
      .groupBy(sql`coalesce(${transactions.category}, 'Uncategorized')`)
      .orderBy(sql`sum(${transactions.amountCents}) desc`),
    // Monthly equivalent of committed recurring bills
    getMonthlyRecurringCents(userId),
  ]);

  const monthsBig = BigInt(months);
  const totalSpendingCents = BigInt(spendingRows[0]?.total ?? '0');
  const totalIncomeCents = BigInt(incomeRows[0]?.total ?? '0');
  const avgSpendingCents = months > 0 ? totalSpendingCents / monthsBig : 0n;
  const avgIncomeCents = months > 0 ? totalIncomeCents / monthsBig : 0n;

  const spendingByCategory: CategorySpendAvg[] = categoryRows.map((r) => ({
    category: r.category,
    avgMonthlyCents: months > 0 ? BigInt(r.total) / monthsBig : 0n,
  }));

  // Confidence based on how much data we have
  const hasData = avgIncomeCents > 0n || avgSpendingCents > 0n;
  const confidence: 'low' | 'medium' | 'high' = !hasData ? 'low' : months < 2 ? 'low' : months < 3 ? 'medium' : 'high';

  return {
    avgIncomeCents,
    avgSpendingCents,
    currentMonthlySavingsCents: avgIncomeCents - avgSpendingCents,
    spendingByCategory,
    committedMonthlyBillsCents: committedCents,
    basedOnMonths: months,
    confidence,
    windowStart: windowStartStr,
    windowEnd: windowEndStr,
  };
}

// ---------------------------------------------------------------------------
// getMonthlyRecurringCents
// ---------------------------------------------------------------------------

/**
 * Compute the total estimated monthly committed expense from the user's
 * recurring series. Converts all cadences to a monthly equivalent using
 * exact-fraction bigint arithmetic to avoid float imprecision.
 *
 * Cadence → monthly multiplier (as fraction numerator/denominator):
 *   weekly     → 52/12
 *   biweekly   → 26/12
 *   monthly    → 1/1
 *   quarterly  → 1/3
 *   annual     → 1/12
 */
export async function getMonthlyRecurringCents(userId: UserId): Promise<bigint> {
  const series = await db
    .select({
      cadence: recurringSeries.cadence,
      expectedAmountCents: recurringSeries.expectedAmountCents,
    })
    .from(recurringSeries)
    .where(eq(recurringSeries.userId, userId));

  let totalMonthly = 0n;
  for (const s of series) {
    const amt = s.expectedAmountCents;
    switch (s.cadence) {
      case 'weekly':
        totalMonthly += (amt * 52n) / 12n;
        break;
      case 'biweekly':
        totalMonthly += (amt * 26n) / 12n;
        break;
      case 'monthly':
        totalMonthly += amt;
        break;
      case 'quarterly':
        totalMonthly += amt / 3n;
        break;
      case 'annual':
        totalMonthly += amt / 12n;
        break;
      default: {
        // Exhaustiveness guard
        const _: never = s.cadence;
        throw new Error(`Unknown cadence: ${String(_)}`);
      }
    }
  }
  return totalMonthly;
}

// ---------------------------------------------------------------------------
// getPeriodSavings
// ---------------------------------------------------------------------------

export type PeriodSavings = {
  readonly incomeCents: bigint;
  readonly spendingCents: bigint;
  /** incomeCents − spendingCents (positive = net saver for the period). */
  readonly savingsCents: bigint;
};

/**
 * Compute income, spending, and net savings for a user within a single
 * calendar month. Uses the same transaction filters as the planner:
 * non-pending, non-deleted, non-transfer.
 *
 * @param period - First day of the calendar month in YYYY-MM-DD format.
 */
export async function getPeriodSavings(userId: UserId, period: string): Promise<PeriodSavings> {
  const periodDate = new Date(period + 'T00:00:00Z');
  const nextMonth = new Date(
    Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth() + 1, 1),
  );
  const periodEnd = nextMonth.toISOString().slice(0, 10);

  const baseWhere = and(
    eq(transactions.userId, userId),
    sql`${transactions.deletedAt} IS NULL`,
    not(transactions.pending),
    not(transactions.isTransfer),
    gte(transactions.postedAt, period),
    lt(transactions.postedAt, periodEnd),
  );

  const [spendingRow, incomeRow] = await Promise.all([
    db
      .select({ total: sql<string>`coalesce(sum(${transactions.amountCents}), '0')` })
      .from(transactions)
      .where(and(baseWhere, sql`${transactions.amountCents} > 0`)),
    db
      .select({ total: sql<string>`coalesce(sum(${transactions.amountCents}) * -1, '0')` })
      .from(transactions)
      .where(and(baseWhere, sql`${transactions.amountCents} < 0`)),
  ]);

  const spendingCents = BigInt(spendingRow[0]?.total ?? '0');
  const incomeCents = BigInt(incomeRow[0]?.total ?? '0');
  return {
    incomeCents,
    spendingCents,
    savingsCents: incomeCents - spendingCents,
  };
}

// ---------------------------------------------------------------------------
// getCategoryActuals
// ---------------------------------------------------------------------------

/**
 * Compute actual spending per category for a user in a calendar month.
 * Returns a Map<category, actualCents> for all spending categories.
 *
 * Applies the same transaction filters as getPlannerContext.
 *
 * @param period - First day of the calendar month in YYYY-MM-DD format.
 */
export async function getCategoryActuals(
  userId: UserId,
  period: string,
): Promise<Map<string, bigint>> {
  const periodDate = new Date(period + 'T00:00:00Z');
  const nextMonth = new Date(
    Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth() + 1, 1),
  );
  const periodEnd = nextMonth.toISOString().slice(0, 10);

  const rows = await db
    .select({
      category: sql<string>`coalesce(${transactions.category}, 'Uncategorized')`,
      total: sql<string>`coalesce(sum(${transactions.amountCents}), '0')`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        sql`${transactions.deletedAt} IS NULL`,
        not(transactions.pending),
        not(transactions.isTransfer),
        sql`${transactions.amountCents} > 0`,
        gte(transactions.postedAt, period),
        lt(transactions.postedAt, periodEnd),
      ),
    )
    .groupBy(sql`coalesce(${transactions.category}, 'Uncategorized')`);

  const map = new Map<string, bigint>();
  for (const r of rows) {
    map.set(r.category, BigInt(r.total));
  }
  return map;
}
