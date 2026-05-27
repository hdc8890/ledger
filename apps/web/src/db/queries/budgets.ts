import { and, eq, gte, lt, not, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { budgets, transactions } from '@/db/schema';
import type { BudgetId, GoalId, UserId } from '@/shared/types';

export type BudgetRow = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;

/**
 * Insert a single budget row. Throws if a row already exists for
 * (user_id, period, category). Use upsertBudget for idempotent writes.
 */
export async function insertBudget(input: NewBudget): Promise<BudgetRow> {
  if (input.capCents <= 0n) throw new Error('insertBudget: capCents must be positive');
  const rows = await db.insert(budgets).values(input).returning();
  const row = rows[0];
  if (!row) throw new Error('insertBudget: no row returned');
  return row;
}

/**
 * Upsert a budget row. On conflict (user_id, period, category):
 * - If manual_override = false: overwrite cap_cents and updated_at.
 * - If manual_override = true: leave the row untouched (user wins).
 *
 * Returns the current row after upsert (inserted or existing if manually overridden).
 */
export async function upsertBudget(input: NewBudget): Promise<BudgetRow> {
  if (input.capCents <= 0n) throw new Error('upsertBudget: capCents must be positive');
  const rows = await db
    .insert(budgets)
    .values(input)
    .onConflictDoUpdate({
      target: [budgets.userId, budgets.period, budgets.category],
      set: {
        capCents: sql`excluded.cap_cents`,
        goalId: sql`excluded.goal_id`,
        createdBy: sql`excluded.created_by`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${budgets.manualOverride} = false`,
    })
    .returning();
  // If manual_override was true the INSERT was skipped; fetch the existing row.
  if (rows.length === 0) {
    const existing = await db
      .select()
      .from(budgets)
      .where(
        and(
          eq(budgets.userId, input.userId),
          eq(budgets.period, input.period as string),
          eq(budgets.category, input.category),
        ),
      )
      .limit(1);
    if (!existing[0]) throw new Error('upsertBudget: row not found after conflict');
    return existing[0];
  }
  const row = rows[0];
  if (!row) throw new Error('upsertBudget: no row returned');
  return row;
}

/**
 * Return all budgets for a user in a given calendar period (YYYY-MM-DD format,
 * first day of the month). Ordered by category name.
 */
export async function getBudgetsByUserPeriod(
  userId: UserId,
  period: string,
): Promise<BudgetRow[]> {
  return db
    .select()
    .from(budgets)
    .where(and(eq(budgets.userId, userId), eq(budgets.period, period)))
    .orderBy(budgets.category);
}

/**
 * Return all budgets associated with a specific goal, across all periods.
 * Ordered by period then category.
 */
export async function getBudgetsByGoalId(
  goalId: GoalId,
  userId: UserId,
): Promise<BudgetRow[]> {
  return db
    .select()
    .from(budgets)
    .where(and(eq(budgets.goalId, goalId), eq(budgets.userId, userId)))
    .orderBy(budgets.period, budgets.category);
}

/**
 * Return all budgets for a user in the current calendar month.
 */
export async function getCurrentMonthBudgets(userId: UserId): Promise<BudgetRow[]> {
  const now = new Date();
  const period = `${now.getUTCFullYear().toString()}-${(now.getUTCMonth() + 1).toString().padStart(2, '0')}-01`;
  return getBudgetsByUserPeriod(userId, period);
}

/**
 * Return all budgets for a user within an inclusive date range of periods.
 */
export async function getBudgetsByUserPeriodRange(
  userId: UserId,
  fromPeriod: string,
  toPeriod: string,
): Promise<BudgetRow[]> {
  return db
    .select()
    .from(budgets)
    .where(
      and(
        eq(budgets.userId, userId),
        gte(budgets.period, fromPeriod),
        lt(budgets.period, toPeriod),
      ),
    )
    .orderBy(budgets.period, budgets.category);
}

/**
 * Fetch a single budget row by ID.
 */
export async function getBudgetById(id: BudgetId): Promise<BudgetRow | undefined> {
  const rows = await db.select().from(budgets).where(eq(budgets.id, id)).limit(1);
  return rows[0];
}

// ---------------------------------------------------------------------------
// getBudgetsWithActuals
// ---------------------------------------------------------------------------

export type BudgetWithActual = BudgetRow & {
  /** Actual spending in cents for this category during the budget period. */
  readonly actualCents: bigint;
};

/**
 * Return all budgets for a user in the given period alongside the actual
 * spending for each budgeted category sourced live from transactions.
 *
 * Actual spending uses the same rules as the planner context:
 *   - Non-pending, non-deleted, non-transfer, positive-amount transactions
 *   - Category matched case-sensitively (NULL → 'Uncategorized')
 *
 * @param period - First day of the calendar month in YYYY-MM-DD format.
 */
export async function getBudgetsWithActuals(
  userId: UserId,
  period: string,
): Promise<BudgetWithActual[]> {
  const periodDate = new Date(period + 'T00:00:00Z');
  const nextMonth = new Date(
    Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth() + 1, 1),
  );
  const periodEnd = nextMonth.toISOString().slice(0, 10);

  const [budgetRows, spendingRows] = await Promise.all([
    getBudgetsByUserPeriod(userId, period),
    db
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
      .groupBy(sql`coalesce(${transactions.category}, 'Uncategorized')`),
  ]);

  const actualsByCategory = new Map<string, bigint>();
  for (const row of spendingRows) {
    actualsByCategory.set(row.category, BigInt(row.total));
  }

  return budgetRows.map((budget) => ({
    ...budget,
    actualCents: actualsByCategory.get(budget.category) ?? 0n,
  }));
}
