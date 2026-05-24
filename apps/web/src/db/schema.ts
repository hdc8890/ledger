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
  integer,
  numeric,
  unique,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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

export const assetKindEnum = pgEnum('asset_kind', [
  'home',
  'vehicle',
  'brokerage',
  'cash',
  'crypto',
  'manual',
]);

export const assetSourceEnum = pgEnum('asset_source', [
  'plaid',
  'api',
  'user',
  'ai',
]);

export const liabilityKindEnum = pgEnum('liability_kind', [
  'mortgage',
  'auto',
  'personal',
  'student',
  'credit_card',
  'other',
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
    /** True when this transaction is identified as an internal transfer (heuristic; Phase 4 enrichment fills this in). */
    isTransfer: boolean('is_transfer').notNull().default(false),
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

// ---------------------------------------------------------------------------
// assets
// User-owned assets: home, vehicles, brokerage accounts, cash, crypto,
// and any manually-entered asset. value_cents is the most-recent known
// value. source + confidence track data provenance per AGENTS.md.
// manual_override = true when the user has explicitly set the value,
// preventing automated refreshes from overwriting it.
// ---------------------------------------------------------------------------
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: assetKindEnum('kind').notNull(),
    name: text('name').notNull(),
    /** Current estimated value in cents. */
    valueCents: bigint('value_cents', { mode: 'bigint' }).notNull(),
    source: assetSourceEnum('source').notNull().default('user'),
    /** 0–1 confidence score for the value estimate. 1.0 for user-entered, lower for API/AI estimates. */
    confidence: real('confidence').notNull().default(1.0),
    /** True when the user has explicitly overridden the value; blocks automated refreshes. */
    manualOverride: boolean('manual_override').notNull().default(false),
    /** Kind-specific metadata: { vin, mileage, address, zestimate_url, … } */
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('assets_user_id_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// liabilities
// Debts: mortgages, auto loans, personal loans, student loans, credit cards,
// and other obligations. Optionally linked to a Plaid account for live
// balance sync. account_id SET NULL on account delete so the record is
// preserved even if the Plaid item is disconnected.
// ---------------------------------------------------------------------------
export const liabilities = pgTable(
  'liabilities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Linked Plaid account, if the liability is synced via Plaid. Null for manual entries. A partial unique index ensures at most one liability per non-null account_id. */
    accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    kind: liabilityKindEnum('kind').notNull(),
    name: text('name').notNull(),
    /** Outstanding balance in cents. */
    balanceCents: bigint('balance_cents', { mode: 'bigint' }).notNull(),
    /** Annual percentage rate (0–1 range). Null if unknown. */
    apr: real('apr'),
    /** Original loan term in months. Null if unknown or revolving. */
    termMonths: integer('term_months'),
    /** Original principal in cents. Null if unknown. */
    originalPrincipalCents: bigint('original_principal_cents', { mode: 'bigint' }),
    /** Liability-specific metadata: { lender, account_mask, … } */
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('liabilities_user_id_idx').on(t.userId),
    // Partial unique index: at most one liability per Plaid account (nulls are distinct and excluded).
    uniqueIndex('liabilities_account_id_uniq').on(t.accountId).where(sql`${t.accountId} IS NOT NULL`),
  ],
);

// ---------------------------------------------------------------------------
// net_worth_snapshots
// Daily point-in-time net worth (assets − liabilities). Populated nightly
// by an Inngest job; the job backfills gaps > 1 day. Used for sparklines
// and trend charts on the Net Worth dashboard. UNIQUE(user_id, date) so
// the job can upsert safely.
// breakdown stores per-kind totals so the allocation donut can render
// from the snapshot without re-querying all assets.
// ---------------------------------------------------------------------------
export const netWorthSnapshots = pgTable(
  'net_worth_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** UTC calendar date for this snapshot (one row per user per day). */
    snapshotDate: date('snapshot_date').notNull(),
    /** Sum of all asset values in cents at snapshot time. */
    assetsCents: bigint('assets_cents', { mode: 'bigint' }).notNull(),
    /** Sum of all liability balances in cents at snapshot time. */
    liabilitiesCents: bigint('liabilities_cents', { mode: 'bigint' }).notNull(),
    /** Per-kind asset totals: { home: 45000000n, brokerage: 12000000n, … } stored as strings to survive JSON round-trip. */
    breakdown: jsonb('breakdown').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('net_worth_snapshots_user_date_uniq').on(t.userId, t.snapshotDate),
    index('net_worth_snapshots_user_date_idx').on(t.userId, t.snapshotDate),
  ],
);

// ---------------------------------------------------------------------------
// Phase 3 — AI Chat tables
// ---------------------------------------------------------------------------

export const chatMessageRoleEnum = pgEnum('chat_message_role', [
  'user',
  'assistant',
  'tool',
]);

export const pendingChangesStatusEnum = pgEnum('pending_changes_status', [
  'pending',
  'applied',
  'rejected',
]);

// ---------------------------------------------------------------------------
// chat_sessions
// One row per conversation. title is populated asynchronously from the first
// user message (Phase 3 Task 6). Cascades on user deletion.
// ---------------------------------------------------------------------------
export const chatSessions = pgTable(
  'chat_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Auto-generated title from first user message. Null until generated. */
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chat_sessions_user_id_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// chat_messages
// Individual turns in a conversation. content is the text payload for
// user/assistant roles, or a tool-call/result descriptor for 'tool' role.
// Cascades on session deletion.
// ---------------------------------------------------------------------------
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => chatSessions.id, { onDelete: 'cascade' }),
    role: chatMessageRoleEnum('role').notNull(),
    /** Text content or structured tool call/result payload. */
    content: jsonb('content').notNull(),
    /** Tool call objects when role='assistant' invokes a tool. */
    toolCalls: jsonb('tool_calls'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chat_messages_session_id_idx').on(t.sessionId)],
);

// ---------------------------------------------------------------------------
// pending_changes
// AI-proposed writes that require user approval before being committed.
// kind identifies the domain object being changed (e.g. 'asset_update',
// 'txn_tag', 'rule_create'). payload contains the full proposed diff.
// Applied/rejected changes are never deleted — kept for audit history.
// ---------------------------------------------------------------------------
export const pendingChanges = pgTable(
  'pending_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Domain discriminator: 'asset_update' | 'txn_tag' | 'rule_create' | … */
    kind: text('kind').notNull(),
    /** Full proposed change payload, validated by the consuming server action. */
    payload: jsonb('payload').notNull(),
    status: pendingChangesStatusEnum('status').notNull().default('pending'),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('pending_changes_user_id_idx').on(t.userId)],
);

// ---------------------------------------------------------------------------
// llm_usage
// Append-only log of every LLM call. Persisted by the logLlmCall helper
// (Phase 3 Task 7). Used for cost monitoring in Settings. No updated_at
// because rows are immutable.
// ---------------------------------------------------------------------------
export const llmUsage = pgTable(
  'llm_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    /** Tool calls invoked during this LLM call, if any. */
    toolCalls: jsonb('tool_calls'),
    /** Estimated USD cost for this call (model-specific token pricing). */
    estimatedCostUsd: numeric('estimated_cost_usd', { precision: 10, scale: 6 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('llm_usage_user_id_idx').on(t.userId)],
);
