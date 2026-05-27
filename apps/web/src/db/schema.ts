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
  customType,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// pgvector custom column type.
// Stores embeddings as vector(N) in Postgres (requires pgvector extension).
// TypeScript representation: number[] (raw floating-point values).
// Driver wire format: "[0.1,0.2,...]" string — the pgvector text representation.
// ---------------------------------------------------------------------------
const pgVector = customType<{
  data: number[];
  driverData: string;
  config: { dimensions: number };
}>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(',')
      .map(Number);
  },
});

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
// categorization_rules
// User-defined rules that map merchant/category predicates to a target
// category. Inserted when a 'rule_create' pending_change is approved.
// Applied during Phase 4 enrichment to auto-tag matching transactions.
// ---------------------------------------------------------------------------
export const categorizationRules = pgTable(
  'categorization_rules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Matching conditions (at least one must be non-null). */
    predicate: jsonb('predicate').notNull(),
    /** The category to assign when the predicate matches. */
    setCategory: text('set_category').notNull(),
    /** Whether the rule is currently active. Soft-disabled rather than deleted. */
    active: boolean('active').notNull().default(true),
    /** Higher number = evaluated first. Default 0. */
    priority: integer('priority').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('categorization_rules_user_id_idx').on(t.userId)],
);
// ---------------------------------------------------------------------------
// chat_rate_limits
// Postgres token-bucket for the chat endpoint. One row per user.
// tokens is atomically decremented on each request; the bucket refills to
// RATE_LIMIT_CAP (50) after RATE_LIMIT_WINDOW (1 hour) has elapsed since
// refilled_at. The update uses INSERT...ON CONFLICT...DO UPDATE so the first
// request auto-creates the row. No updated_at — the row is mutated atomically
// via raw SQL rather than Drizzle UPDATE, so a trigger would race.
// ---------------------------------------------------------------------------
export const chatRateLimits = pgTable('chat_rate_limits', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Remaining tokens in the current window (0 = exhausted). */
  tokens: integer('tokens').notNull(),
  /** UTC timestamp when the current window started (used to detect expiry). */
  refilledAt: timestamp('refilled_at', { withTimezone: true }).notNull().defaultNow(),
  /** Row creation timestamp — set once on first request and never changed. */
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Phase 4 — AI Enrichment tables
// ---------------------------------------------------------------------------

export const merchantAliasCreatedByEnum = pgEnum('merchant_alias_created_by', [
  'seed',
  'user',
  'ai',
]);

// ---------------------------------------------------------------------------
// merchant_aliases
// Maps raw merchant strings (exact or /regex/ patterns) to canonical names.
// Deterministic rules are checked first (highest priority first); an LLM
// call is made only when no rule matches. AI results are cached here with
// created_by='ai' so repeat calls are avoided.
// This is a global table (no user_id FK) — aliases apply to all users.
// ---------------------------------------------------------------------------
export const merchantAliases = pgTable(
  'merchant_aliases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Raw merchant string to match. Wrap in forward-slashes to denote a regex pattern. */
    rawPattern: text('raw_pattern').notNull(),
    /** Canonical merchant name, e.g. "Amazon Prime". */
    canonical: text('canonical').notNull(),
    /** Optional category hint to seed Phase 4 Task 2 categorization. */
    categoryHint: text('category_hint'),
    /** Higher priority rules are checked first. Default 0. */
    priority: integer('priority').notNull().default(0),
    createdBy: merchantAliasCreatedByEnum('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('merchant_aliases_priority_idx').on(t.priority),
    uniqueIndex('merchant_aliases_raw_pattern_uniq').on(t.rawPattern),
  ],
);

// ---------------------------------------------------------------------------
// transfer_links
// Explicit pairing of an outbound transaction (debit) with the corresponding
// inbound transaction (credit) that together constitute an internal transfer
// between the user's own accounts.
//
// Detection: heuristic — same user, opposite signs, |Δamount| < 1%,
// |Δdate| ≤ 3 days, different accounts. Written by the Phase 4 Task 3
// Inngest job; never written directly by the user.
//
// Both FKs cascade on delete so the link row disappears if either leg is
// removed (e.g. Plaid marks a transaction removed in a future sync).
// UNIQUE (out_txn_id, in_txn_id) makes upserts idempotent.
//
// transactions.is_transfer is set to true on both legs for fast query-time
// exclusion without a join.
// ---------------------------------------------------------------------------
export const transferLinks = pgTable(
  'transfer_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Debit leg: amountCents > 0 (money leaving the account). */
    outTxnId: uuid('out_txn_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    /** Credit leg: amountCents < 0 (money entering the account). */
    inTxnId: uuid('in_txn_id')
      .notNull()
      .references(() => transactions.id, { onDelete: 'cascade' }),
    /** 0–1 pairing confidence from the heuristic algorithm. */
    confidence: real('confidence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('transfer_links_pair_uniq').on(t.outTxnId, t.inTxnId),
    index('transfer_links_user_id_idx').on(t.userId),
    index('transfer_links_out_txn_id_idx').on(t.outTxnId),
    index('transfer_links_in_txn_id_idx').on(t.inTxnId),
  ],
);

// ---------------------------------------------------------------------------
// Phase 4 Task 4 — Recurring bill detection
// ---------------------------------------------------------------------------

export const recurringCadenceEnum = pgEnum('recurring_cadence', [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'annual',
]);

// ---------------------------------------------------------------------------
// recurring_series
// One row per (user, merchant_normalized, cadence) triple representing a
// detected recurring payment pattern (subscriptions, utilities, etc.).
//
// Written by the detect-recurring Inngest job; never written by the user
// directly. Upserted on (user_id, merchant_normalized, cadence) so
// re-running the job is idempotent and keeps the row current.
//
// No FK to transactions — this is a derived aggregate, not a row link.
// Cascades on user deletion.
// ---------------------------------------------------------------------------
export const recurringSeries = pgTable(
  'recurring_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Cleaned merchant name from merchant_normalized (enrichment Task 1). */
    merchantNormalized: text('merchant_normalized').notNull(),
    cadence: recurringCadenceEnum('cadence').notNull(),
    /** Median transaction amount for this series, in cents. */
    expectedAmountCents: bigint('expected_amount_cents', { mode: 'bigint' }).notNull(),
    /** Fractional tolerance around expectedAmountCents to still count as a match (default 0.10 = ±10%). */
    amountTolerancePct: real('amount_tolerance_pct').notNull().default(0.1),
    /** Next predicted posting date based on last_seen_at + cadence. Null when unknown. */
    nextExpectedAt: date('next_expected_at'),
    /** Most recent transaction date that matches this series. */
    lastSeenAt: date('last_seen_at').notNull(),
    /** 0–1 confidence score for the detected pattern. */
    confidence: real('confidence').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('recurring_series_user_merchant_cadence_uniq').on(
      t.userId,
      t.merchantNormalized,
      t.cadence,
    ),
    index('recurring_series_user_id_idx').on(t.userId),
    index('recurring_series_next_expected_idx').on(t.userId, t.nextExpectedAt),
  ],
);

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

// ---------------------------------------------------------------------------
// Phase 5 — Memory Layer tables
// ---------------------------------------------------------------------------

export const memoryKindEnum = pgEnum('memory_kind', [
  'preference',
  'household_rule',
  'historical_context',
  'goal',
  'override_note',
]);

export const memoryProposalStatusEnum = pgEnum('memory_proposal_status', [
  'pending',
  'accepted',
  'rejected',
]);

// ---------------------------------------------------------------------------
// memories
// Persistent semantic memories indexed by pgvector embeddings for ANN search.
// Content is intentionally semantic — no raw amounts, account numbers, or
// institution names (per AGENTS.md §0 privacy directive).
//
// embedding is nullable so a row can be inserted before the embedding is
// computed (fire-and-forget embedding generation). Retrieval filters out rows
// with a null embedding.
//
// The HNSW index for cosine similarity (vector_cosine_ops) is created in the
// SQL migration because Drizzle's index() builder does not support custom
// operator classes for vector columns.
// ---------------------------------------------------------------------------
export const memories = pgTable(
  'memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: memoryKindEnum('kind').notNull(),
    /** Semantic content — must not contain raw amounts or account identifiers. */
    text: text('text').notNull(),
    /** 1536-dimensional text-embedding-3-small vector. Null until computed. */
    embedding: pgVector('embedding', { dimensions: 1536 }),
    /** Optional structured metadata: { source_txn_id, related_asset_id, … } */
    metadata: jsonb('metadata'),
    /** 0–1 confidence. 1.0 for user-confirmed memories, lower for auto-extracted. */
    confidence: real('confidence').notNull().default(1.0),
    /** Optional TTL — memory is excluded from retrieval after this timestamp. */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('memories_user_id_idx').on(t.userId),
    index('memories_user_kind_idx').on(t.userId, t.kind),
  ],
);

// ---------------------------------------------------------------------------
// memory_proposals
// Auto-extracted memory candidates produced after each chat turn (Phase 5
// Task 4). Stored as pending until the user accepts or dismisses the chip.
//
// Rejected proposals are retained (never re-proposed) to prevent repetition.
// source_session_id is SET NULL on session deletion so the proposal is
// preserved even if the originating conversation is deleted.
// ---------------------------------------------------------------------------
export const memoryProposals = pgTable(
  'memory_proposals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    proposedText: text('proposed_text').notNull(),
    proposedKind: text('proposed_kind').notNull(),
    /** Chat session that triggered the auto-extraction job. */
    sourceSessionId: uuid('source_session_id').references(() => chatSessions.id, {
      onDelete: 'set null',
    }),
    status: memoryProposalStatusEnum('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('memory_proposals_user_id_idx').on(t.userId),
    index('memory_proposals_user_status_idx').on(t.userId, t.status),
  ],
);

// ---------------------------------------------------------------------------
// Phase 6 — Goal-Based Planning tables
// ---------------------------------------------------------------------------

export const goalKindEnum = pgEnum('goal_kind', [
  'save_for',
  'accelerate_debt',
  'reduce_category_spend',
  'increase_savings_rate',
]);

export const goalStatusEnum = pgEnum('goal_status', [
  'active',
  'achieved',
  'archived',
  'paused',
]);

// ---------------------------------------------------------------------------
// goals
// A high-level financial goal that the user (or agent) has created.
// Target amount and date are optional — not all goal kinds require them.
// constraints: { exclude_categories: string[], max_monthly_reduction_cents: string }
// priority: higher = first claim on discretionary dollars during arbitration.
// ON DELETE CASCADE — goals disappear when the user is deleted.
// ---------------------------------------------------------------------------
export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: goalKindEnum('kind').notNull(),
    name: text('name').notNull(),
    /** Target amount in cents. Null for goals where no fixed amount applies (e.g. increase_savings_rate). */
    targetAmountCents: bigint('target_amount_cents', { mode: 'bigint' }),
    /** Target completion date. Null when open-ended. */
    targetDate: date('target_date'),
    /** Allocation priority for multi-goal arbitration. Higher wins. Default 0. */
    priority: integer('priority').notNull().default(0),
    /** Optional constraints: { exclude_categories: string[], max_monthly_reduction_cents: string } */
    constraints: jsonb('constraints').notNull().default({}),
    status: goalStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('goals_user_id_idx').on(t.userId),
    index('goals_user_status_idx').on(t.userId, t.status),
  ],
);
