import { and, eq, gte, gt, inArray, isNull, lt, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { transactions } from '@/db/schema';
import type { AccountId, TransactionId, UserId } from '@/shared/types';

export type TransactionRow = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

/**
 * Insert or update a transaction row, keyed on plaid_transaction_id.
 * On conflict, refreshes mutable fields (amount, pending, posted_at, etc.)
 * that Plaid may update after initial posting.
 * Idempotent — safe to call on every sync for added + modified transactions.
 */
export async function upsertTransaction(input: NewTransaction): Promise<TransactionRow> {
  const rows = await db
    .insert(transactions)
    .values(input)
    .onConflictDoUpdate({
      target: transactions.plaidTransactionId,
      set: {
        postedAt: input.postedAt,
        authorizedAt: input.authorizedAt,
        amountCents: input.amountCents,
        merchantRaw: input.merchantRaw,
        pending: input.pending,
        updatedAt: new Date(),
      },
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('upsertTransaction: no row returned');
  return row;
}

/**
 * Soft-delete a transaction by its Plaid transaction ID.
 * Called for transactions in the `removed` array from /transactions/sync.
 */
export async function softDeleteTransactionByPlaidId(
  plaidTransactionId: string,
  at: Date,
): Promise<void> {
  await db
    .update(transactions)
    .set({ deletedAt: at, updatedAt: at })
    .where(eq(transactions.plaidTransactionId, plaidTransactionId));
}

/**
 * Fetch active (non-deleted) transactions for a user, newest first.
 * Accepts optional pagination parameters.
 */
export async function getTransactionsByUserId(
  userId: UserId,
  options: { limit?: number; offset?: number } = {},
): Promise<TransactionRow[]> {
  const { limit = 100, offset = 0 } = options;
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)))
    .limit(limit)
    .offset(offset);
}

/**
 * Fetch all active transactions for an account.
 */
export async function getTransactionsByAccountId(accountId: AccountId): Promise<TransactionRow[]> {
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.accountId, accountId), isNull(transactions.deletedAt)));
}

/**
 * Fetch a single transaction by internal UUID. Returns undefined if not found.
 */
export async function getTransactionById(id: TransactionId): Promise<TransactionRow | undefined> {
  const rows = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  return rows[0];
}

/**
 * Update the category and category source for a transaction.
 * Used when a 'txn_tag' pending change is approved (Phase 3 Task 4).
 */
export async function updateTransactionCategory(
  id: TransactionId,
  category: string,
  source: TransactionRow['categorySource'],
): Promise<TransactionRow | undefined> {
  const rows = await db
    .update(transactions)
    .set({ category, categorySource: source, categoryConfidence: 1.0, updatedAt: new Date() })
    .where(eq(transactions.id, id))
    .returning();
  return rows[0];
}

/**
 * Fetch active transactions that need category enrichment.
 * "Needs enrichment" means categorySource is NULL (no Plaid category) or 'plaid'
 * (we can improve on Plaid's generic categorization with deterministic rules or LLM).
 * Skips rows already tagged by user/rule/ai so the job is idempotent.
 */
export async function getTransactionsNeedingCategorization(
  userId: UserId,
  options: { limit?: number; offset?: number } = {},
): Promise<TransactionRow[]> {
  const { limit = 100, offset = 0 } = options;
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        sql`(${transactions.categorySource} IS NULL OR ${transactions.categorySource} = 'plaid')`,
      ),
    )
    .orderBy(transactions.postedAt)
    .limit(limit)
    .offset(offset);
}

/**
 * Update category, source, and confidence for a transaction.
 * Used by the Phase 4 enrichment pipeline (category inference).
 * Accepts a confidence parameter unlike the legacy updateTransactionCategory.
 */
export async function updateTransactionCategoryEnriched(
  id: TransactionId,
  category: string,
  source: 'rule' | 'ai',
  confidence: number,
): Promise<TransactionRow | undefined> {
  const rows = await db
    .update(transactions)
    .set({ category, categorySource: source, categoryConfidence: confidence, updatedAt: new Date() })
    .where(eq(transactions.id, id))
    .returning();
  return rows[0];
}

/**
 * Update the normalized merchant name for a transaction.
 * Called by the Phase 4 enrichment pipeline after merchant normalization.
 */
export async function updateTransactionMerchantNormalized(
  id: TransactionId,
  merchantNormalized: string,
): Promise<TransactionRow | undefined> {
  const rows = await db
    .update(transactions)
    .set({ merchantNormalized, updatedAt: new Date() })
    .where(eq(transactions.id, id))
    .returning();
  return rows[0];
}

/**
 * Fetch active transactions that have not yet been merchant-normalized.
 * Used by the Phase 4 enrichment pipeline to find work to do.
 * Results are ordered oldest-first so backfill processes in chronological order.
 */
export async function getTransactionsNeedingNormalization(
  userId: UserId,
  options: { limit?: number; offset?: number } = {},
): Promise<TransactionRow[]> {
  const { limit = 100, offset = 0 } = options;
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        isNull(transactions.merchantNormalized),
      ),
    )
    .orderBy(transactions.postedAt)
    .limit(limit)
    .offset(offset);
}

export type TransactionFilter = {
  readonly startDate?: string; // YYYY-MM-DD inclusive
  readonly endDate?: string; // YYYY-MM-DD inclusive
  readonly category?: string;
  readonly accountId?: string;
  /** Positive cents threshold: only return transactions with amountCents > value */
  readonly minAmountCents?: bigint;
  /** Positive cents threshold: only return transactions with amountCents < value */
  readonly maxAmountCents?: bigint;
  readonly limit?: number;
  readonly offset?: number;
};

/**
 * Fetch active transactions for a user with optional filters.
 * Results are ordered by posted_at descending (newest first).
 */
export async function queryTransactionsByFilter(
  userId: UserId,
  filter: TransactionFilter = {},
): Promise<TransactionRow[]> {
  const { startDate, endDate, category, accountId, minAmountCents, maxAmountCents, limit = 50, offset = 0 } =
    filter;

  const conditions = [eq(transactions.userId, userId), isNull(transactions.deletedAt)];

  if (startDate !== undefined) conditions.push(gte(transactions.postedAt, startDate));
  if (endDate !== undefined) conditions.push(lte(transactions.postedAt, endDate));
  if (category !== undefined) conditions.push(eq(transactions.category, category));
  if (accountId !== undefined) conditions.push(eq(transactions.accountId, accountId));
  if (minAmountCents !== undefined) conditions.push(gt(transactions.amountCents, minAmountCents));
  if (maxAmountCents !== undefined) conditions.push(lt(transactions.amountCents, maxAmountCents));

  return db
    .select()
    .from(transactions)
    .where(and(...conditions))
    .orderBy(sql`${transactions.postedAt} desc`)
    .limit(limit)
    .offset(offset);
}

export type AggregateGroup = 'category' | 'merchant' | 'month';
export type TransactionType = 'spending' | 'income' | 'all';

export type AggregateTransactionParams = {
  readonly startDate: string; // YYYY-MM-DD
  readonly endDate: string; // YYYY-MM-DD
  readonly groupBy: AggregateGroup;
  readonly type?: TransactionType;
  readonly excludeTransfers?: boolean;
};

export type AggregateRow = {
  readonly key: string;
  readonly totalCents: bigint;
  readonly count: number;
};

/**
 * Aggregate transactions by category, merchant, or calendar month.
 * Returns rows sorted by totalCents descending (highest spend first).
 * Amounts are always returned as positive cents (absolute value).
 */
export async function aggregateTransactions(
  userId: UserId,
  params: AggregateTransactionParams,
): Promise<AggregateRow[]> {
  const { startDate, endDate, groupBy, type = 'spending', excludeTransfers = true } = params;

  const conditions = [
    eq(transactions.userId, userId),
    isNull(transactions.deletedAt),
    sql`${transactions.pending} = false`,
    gte(transactions.postedAt, startDate),
    lte(transactions.postedAt, endDate),
  ];

  if (type === 'spending') conditions.push(sql`${transactions.amountCents} > 0`);
  if (type === 'income') conditions.push(sql`${transactions.amountCents} < 0`);
  if (excludeTransfers) conditions.push(sql`${transactions.isTransfer} = false`);

  const keyExpr =
    groupBy === 'category'
      ? sql<string>`coalesce(${transactions.category}, 'Uncategorized')`
      : groupBy === 'merchant'
        ? sql<string>`coalesce(${transactions.merchantNormalized}, ${transactions.merchantRaw})`
        : sql<string>`to_char(${transactions.postedAt}::date, 'YYYY-MM')`;

  const rows = await db
    .select({
      key: keyExpr,
      total: sql<string>`sum(abs(${transactions.amountCents}))`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(keyExpr)
    .orderBy(sql`sum(abs(${transactions.amountCents})) desc`);

  return rows.map((r) => ({
    key: r.key,
    totalCents: BigInt(r.total ?? '0'),
    count: r.count,
  }));
}

/**
 * Reset enrichment state for a user's transactions, enabling the enrichment
 * pipeline to re-process them from scratch.
 *
 * Only affects rows whose categorySource is 'ai' or 'rule'. Rows tagged by
 * the user (categorySource = 'user') are intentionally preserved — manual
 * overrides always win.
 *
 * Sets:
 *   merchant_normalized = NULL   → triggers re-normalization
 *   category_source     = NULL   → triggers re-categorization
 *   category_confidence = NULL
 *
 * Returns the number of rows reset.
 */
export async function resetTransactionEnrichmentForUser(userId: UserId): Promise<number> {
  const rows = await db
    .update(transactions)
    .set({ merchantNormalized: null, categorySource: null, categoryConfidence: null, updatedAt: new Date() })
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        inArray(transactions.categorySource, ['ai', 'rule']),
      ),
    )
    .returning({ id: transactions.id });

  return rows.length;
}
