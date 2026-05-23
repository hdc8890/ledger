import { and, eq, gte, lt, not, sql } from 'drizzle-orm';
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
