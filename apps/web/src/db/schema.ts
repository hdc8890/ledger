import {
  pgTable,
  pgEnum,
  uuid,
  text,
  jsonb,
  timestamp,
  date,
  bigint,
  boolean,
  real,
  index,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const plaidItemStatusEnum = pgEnum('plaid_item_status', [
  'active',
  'disconnected',
  'error',
]);

export const categorySourceEnum = pgEnum('category_source', [
  'plaid',
  'ai',
  'user',
  'rule',
]);

export const transactionSourceEnum = pgEnum('transaction_source', [
  'plaid',
  'csv',
  'manual',
]);

export const auditSourceEnum = pgEnum('audit_source', [
  'user',
  'ai',
  'system',
  'rule',
]);

// ---------------------------------------------------------------------------
// users
// Top-level identity row, keyed on Clerk's user ID.
// Created via the /api/webhooks/clerk handler on first sign-in.
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  /** Household the user belongs to — null until household is created. */
  householdId: uuid('household_id'),
  /** Feature flags and preferences: { flags: Record<string, boolean>, timezone: string } */
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// plaid_items
// One row per connected institution / Plaid Item.
// Access token stored encrypted (libsodium) — never logged or returned to client.
// ---------------------------------------------------------------------------
export const plaidItems = pgTable(
  'plaid_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Encrypted Plaid access token (libsodium secretbox). */
    accessTokenEnc: text('access_token_enc').notNull(),
    institutionId: text('institution_id').notNull(),
    institutionName: text('institution_name').notNull(),
    status: plaidItemStatusEnum('status').notNull().default('active'),
    /** Plaid's external item ID (returned by itemPublicTokenExchange). Used to look up rows from webhook payloads. */
    plaidItemId: text('plaid_item_id').notNull().unique(),
    /** Cursor for /transactions/sync — null before first sync. */
    cursor: text('cursor'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('plaid_items_user_id_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// accounts
// Bank/investment/loan accounts pulled from Plaid.
// plaid_account_id is the stable Plaid identifier used for idempotent upserts.
// Soft-deleted when the parent Plaid item is disconnected.
// ---------------------------------------------------------------------------
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    plaidItemId: uuid('plaid_item_id')
      .notNull()
      .references(() => plaidItems.id, { onDelete: 'cascade' }),
    plaidAccountId: text('plaid_account_id').notNull().unique(),
    name: text('name').notNull(),
    officialName: text('official_name'),
    mask: text('mask'),
    /** checking | savings | credit | investment | loan */
    type: text('type').notNull(),
    subtype: text('subtype').notNull(),
    currency: text('currency').notNull().default('USD'),
    /** Current balance in cents (bigint — never float). */
    balanceCurrent: bigint('balance_current', { mode: 'bigint' }).notNull(),
    /** Available balance in cents; null for accounts where this concept doesn't apply. */
    balanceAvailable: bigint('balance_available', { mode: 'bigint' }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('accounts_user_id_idx').on(t.userId),
    index('accounts_plaid_item_id_idx').on(t.plaidItemId),
  ],
);

// ---------------------------------------------------------------------------
// transactions
// Normalized transaction rows from Plaid (or CSV / manual entry).
// amount_cents: positive = debit (money out), negative = credit (money in).
// plaid_transaction_id is null for CSV/manual; upsert keys on it when present.
// Soft-deleted for Plaid "removed" transactions (deleted_at set).
// ---------------------------------------------------------------------------
export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    /** Plaid's stable transaction ID. Null for CSV/manual. Used as upsert key. */
    plaidTransactionId: text('plaid_transaction_id').unique(),
    postedAt: date('posted_at').notNull(),
    authorizedAt: date('authorized_at'),
    /** Amount in cents. Positive = debit (money out), negative = credit (money in). */
    amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull().default('USD'),
    /** Raw merchant string from Plaid (original_description / name). */
    merchantRaw: text('merchant_raw').notNull(),
    /** Cleaned merchant name after enrichment. Null until enriched. */
    merchantNormalized: text('merchant_normalized'),
    category: text('category'),
    categorySource: categorySourceEnum('category_source'),
    /** 0–1 confidence score for the assigned category. */
    categoryConfidence: real('category_confidence'),
    pending: boolean('pending').notNull().default(false),
    source: transactionSourceEnum('source').notNull().default('plaid'),
    /** Overall data confidence: 1.0 for Plaid, lower for inferred data. */
    confidence: real('confidence').notNull().default(1.0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('transactions_user_id_idx').on(t.userId),
    index('transactions_account_id_idx').on(t.accountId),
    index('transactions_user_posted_idx').on(t.userId, t.postedAt),
  ],
);

// ---------------------------------------------------------------------------
// audit_events
// Immutable append-only log of every write that touches financial data.
// Written for: AI proposals applied, user overrides, item connect/disconnect,
// category changes. No updated_at — rows never mutate.
// ---------------------------------------------------------------------------
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Clerk user ID, 'system', or 'ai'. */
    actor: text('actor').notNull(),
    /** Dot-separated action: 'plaid.connect', 'txn.tag', 'asset.update', … */
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    source: auditSourceEnum('source').notNull(),
    confidence: real('confidence'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_events_entity_id_idx').on(t.entityId)],
);
