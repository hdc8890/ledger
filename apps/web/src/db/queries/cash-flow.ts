import { and, eq, gte, lt, lte, not, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { transactions } from '@/db/schema';
import type { UserId } from '@/shared/types';

export type CashFlowMonth = {
  /** UTC year-month label: 'YYYY-MM'. */
  readonly month: string;
  /** Total credits (money in) in cents — positive value. */
  readonly incomeCents: bigint;
  /** Total debits (money out) in cents — positive value. Excludes transfers. */
  readonly spendingCents: bigint;
  /** incomeCents − spendingCents (positive = net saver). */
  readonly savingsCents: bigint;
  /** Top spending categories for this month, descending by total. */
  readonly topCategories: ReadonlyArray<{
    readonly category: string;
    readonly totalCents: bigint;
  }>;
};

export type SpendingByCategory = {
  readonly category: string;
  readonly totalCents: bigint;
};

/**
 * Return cash flow totals (income, spending, savings) and top spending
 * categories for the given calendar month.
 *
 * Rules:
 * - Positive amount_cents = debit (money out = spending).
 * - Negative amount_cents = credit (money in = income).
 * - Pending and soft-deleted transactions are excluded.
 * - Transfer-flagged transactions (is_transfer = true) are excluded from spending.
 *
 * @param userId - The user's internal UUID.
 * @param month  - Any Date whose UTC year+month identifies the target month.
 */
export async function getCashFlow(userId: UserId, month: Date): Promise<CashFlowMonth> {
  const year = month.getUTCFullYear();
  const mon = month.getUTCMonth() + 1;
  const monthStr = `${year.toString()}-${mon.toString().padStart(2, '0')}`;

  // First day of target month (inclusive), first day of next month (exclusive).
  const startDate = `${monthStr}-01`;
  const nextMonth = new Date(Date.UTC(year, mon, 1));
  const endDate = nextMonth.toISOString().slice(0, 10);

  const baseCondition = and(
    eq(transactions.userId, userId),
    sql`${transactions.deletedAt} is null`,
    not(transactions.pending),
    gte(transactions.postedAt, startDate),
    lt(transactions.postedAt, endDate),
  );

  // Spending: positive amounts, excluding transfers
  const spendingCondition = and(
    baseCondition,
    sql`${transactions.amountCents} > 0`,
    not(transactions.isTransfer),
  );

  // Income: negative amounts (credits) — transfers are excluded too since internal
  // transfers show up as both a debit and a credit.
  const incomeCondition = and(
    baseCondition,
    sql`${transactions.amountCents} < 0`,
    not(transactions.isTransfer),
  );

  const [spendingRows, incomeRows, categoryRows] = await Promise.all([
    db
      .select({ total: sql<string>`sum(${transactions.amountCents})` })
      .from(transactions)
      .where(spendingCondition),
    db
      .select({ total: sql<string>`sum(${transactions.amountCents}) * -1` })
      .from(transactions)
      .where(incomeCondition),
    db
      .select({
        category: sql<string>`coalesce(${transactions.category}, 'Uncategorized')`,
        total: sql<string>`sum(${transactions.amountCents})`,
      })
      .from(transactions)
      .where(spendingCondition)
      .groupBy(sql`coalesce(${transactions.category}, 'Uncategorized')`)
      .orderBy(sql`sum(${transactions.amountCents}) desc`)
      .limit(5),
  ]);

  const spendingCents = BigInt(spendingRows[0]?.total ?? '0');
  const incomeCents = BigInt(incomeRows[0]?.total ?? '0');

  return {
    month: monthStr,
    incomeCents,
    spendingCents,
    savingsCents: incomeCents - spendingCents,
    topCategories: categoryRows.map((r) => ({
      category: r.category,
      totalCents: BigInt(r.total ?? '0'),
    })),
  };
}

/**
 * Return monthly cash flow summaries for the last N months, newest first.
 * Used by the grouped bar chart on the Cash Flow dashboard.
 *
 * @param months - Number of calendar months to return (default: 6).
 */
export async function getCashFlowSeries(
  userId: UserId,
  months = 6,
): Promise<CashFlowMonth[]> {
  const results: CashFlowMonth[] = [];
  const now = new Date();
  for (let i = 0; i < months; i++) {
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    results.push(await getCashFlow(userId, target));
  }
  return results;
}

// ---------------------------------------------------------------------------
// Period summary and forecast — used by AI tools (Phase 3 Task 2)
// ---------------------------------------------------------------------------

export type PeriodSummary = {
  readonly period: { readonly start: string; readonly end: string };
  readonly incomeCents: bigint;
  readonly spendingCents: bigint;
  readonly savingsCents: bigint;
  readonly topSpendingCategories: ReadonlyArray<{
    readonly category: string;
    readonly totalCents: bigint;
    readonly count: number;
  }>;
  readonly topMerchants: ReadonlyArray<{
    readonly merchant: string;
    readonly totalCents: bigint;
    readonly count: number;
  }>;
};

/**
 * Summarize income, spending, savings, and top categories/merchants for an
 * arbitrary date range (start and end as YYYY-MM-DD, both inclusive).
 */
export async function summarizePeriod(
  userId: UserId,
  startDate: string,
  endDate: string,
): Promise<PeriodSummary> {
  const baseCondition = and(
    eq(transactions.userId, userId),
    sql`${transactions.deletedAt} is null`,
    not(transactions.pending),
    gte(transactions.postedAt, startDate),
    lte(transactions.postedAt, endDate),
    not(transactions.isTransfer),
  );

  const spendingCondition = and(baseCondition, sql`${transactions.amountCents} > 0`);
  const incomeCondition = and(baseCondition, sql`${transactions.amountCents} < 0`);

  const [spendingRows, incomeRows, categoryRows, merchantRows] = await Promise.all([
    db
      .select({ total: sql<string>`sum(${transactions.amountCents})` })
      .from(transactions)
      .where(spendingCondition),
    db
      .select({ total: sql<string>`sum(${transactions.amountCents}) * -1` })
      .from(transactions)
      .where(incomeCondition),
    db
      .select({
        category: sql<string>`coalesce(${transactions.category}, 'Uncategorized')`,
        total: sql<string>`sum(${transactions.amountCents})`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(spendingCondition)
      .groupBy(sql`coalesce(${transactions.category}, 'Uncategorized')`)
      .orderBy(sql`sum(${transactions.amountCents}) desc`)
      .limit(8),
    db
      .select({
        merchant: sql<string>`coalesce(${transactions.merchantNormalized}, ${transactions.merchantRaw})`,
        total: sql<string>`sum(${transactions.amountCents})`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(spendingCondition)
      .groupBy(sql`coalesce(${transactions.merchantNormalized}, ${transactions.merchantRaw})`)
      .orderBy(sql`sum(${transactions.amountCents}) desc`)
      .limit(8),
  ]);

  const spendingCents = BigInt(spendingRows[0]?.total ?? '0');
  const incomeCents = BigInt(incomeRows[0]?.total ?? '0');

  return {
    period: { start: startDate, end: endDate },
    incomeCents,
    spendingCents,
    savingsCents: incomeCents - spendingCents,
    topSpendingCategories: categoryRows.map((r) => ({
      category: r.category,
      totalCents: BigInt(r.total ?? '0'),
      count: r.count,
    })),
    topMerchants: merchantRows.map((r) => ({
      merchant: r.merchant,
      totalCents: BigInt(r.total ?? '0'),
      count: r.count,
    })),
  };
}

export type CashFlowForecast = {
  readonly projections: ReadonlyArray<{
    readonly month: string; // YYYY-MM
    readonly projectedIncomeCents: bigint;
    readonly projectedSpendingCents: bigint;
    readonly projectedSavingsCents: bigint;
  }>;
  readonly methodology: string;
  readonly confidence: 'low' | 'medium' | 'high';
};

/**
 * Forecast cash flow for the next N months by averaging the last 3 completed
 * months. Returns 'low' confidence when fewer than 2 months of history exist.
 */
export async function forecastCashFlowFromHistory(
  userId: UserId,
  months: number,
): Promise<CashFlowForecast> {
  // Pull last 3 completed months as the baseline.
  const history = await getCashFlowSeries(userId, 3);

  const nonEmpty = history.filter((m) => m.incomeCents > 0n || m.spendingCents > 0n);

  const avgIncome =
    nonEmpty.length > 0
      ? nonEmpty.reduce((sum, m) => sum + m.incomeCents, 0n) / BigInt(nonEmpty.length)
      : 0n;
  const avgSpending =
    nonEmpty.length > 0
      ? nonEmpty.reduce((sum, m) => sum + m.spendingCents, 0n) / BigInt(nonEmpty.length)
      : 0n;

  const now = new Date();
  const projections = Array.from({ length: months }, (_, i) => {
    const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 + i, 1));
    const year = target.getUTCFullYear();
    const mon = target.getUTCMonth() + 1;
    const month = `${year.toString()}-${mon.toString().padStart(2, '0')}`;
    return {
      month,
      projectedIncomeCents: avgIncome,
      projectedSpendingCents: avgSpending,
      projectedSavingsCents: avgIncome - avgSpending,
    };
  });

  const confidence: 'low' | 'medium' | 'high' =
    nonEmpty.length === 0 ? 'low' : nonEmpty.length === 1 ? 'low' : nonEmpty.length === 2 ? 'medium' : 'high';

  return {
    projections,
    methodology: `Based on ${nonEmpty.length > 0 ? nonEmpty.length : 'no'} month(s) of recent history`,
    confidence,
  };
}
