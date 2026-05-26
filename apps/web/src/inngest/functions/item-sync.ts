import { NonRetriableError } from 'inngest';
import type { Transaction, AccountBase } from 'plaid';
import { inngest } from '@/lib/inngest';
import { plaidClient } from '@/lib/plaid';
import { decryptSecret } from '@/lib/encrypt';
import { dollarsToCents } from '@/shared/money';
import {
  getPlaidItemById,
  updatePlaidItemCursor,
} from '@/db/queries/plaid-items';
import { getAccountsByPlaidItemId, upsertAccount } from '@/db/queries/accounts';
import { upsertTransaction, softDeleteTransactionByPlaidId } from '@/db/queries/transactions';
import type { AccountId, PlaidItemId, UserId } from '@/shared/types';
import type { PlaidItemRow } from '@/db/queries/plaid-items';
import type { AccountRow } from '@/db/queries/accounts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a Plaid transaction to our normalized schema shape. */
function mapTransaction(
  txn: Transaction,
  item: PlaidItemRow,
  account: AccountRow,
) {
  const category = txn.personal_finance_category?.primary ?? txn.category?.[0] ?? null;
  const categorySource = txn.personal_finance_category != null ? ('plaid' as const) : null;

  return {
    userId: item.userId as UserId,
    accountId: account.id as AccountId,
    plaidTransactionId: txn.transaction_id,
    postedAt: txn.date,
    authorizedAt: txn.authorized_date ?? null,
    // Plaid: positive = money out (debit), same as our schema convention.
    amountCents: dollarsToCents(txn.amount),
    currency: txn.iso_currency_code ?? txn.unofficial_currency_code ?? 'USD',
    merchantRaw: txn.merchant_name ?? txn.name,
    merchantNormalized: null,
    category,
    categorySource,
    categoryConfidence: null,
    pending: txn.pending,
    source: 'plaid' as const,
    confidence: 1.0,
  };
}

/** Upsert a Plaid AccountBase into our accounts table, returning the updated row. */
async function upsertPlaidAccount(
  pa: AccountBase,
  item: PlaidItemRow,
  existing: AccountRow | undefined,
  now: Date,
): Promise<AccountRow> {
  return upsertAccount({
    userId: (existing?.userId ?? item.userId) as UserId,
    plaidItemId: (existing?.plaidItemId ?? item.id) as PlaidItemId,
    plaidAccountId: pa.account_id,
    name: pa.name,
    officialName: pa.official_name ?? null,
    mask: pa.mask ?? null,
    type: pa.type,
    subtype: pa.subtype ?? 'other',
    currency: pa.balances.iso_currency_code ?? 'USD',
    balanceCurrent: dollarsToCents(pa.balances.current ?? 0),
    balanceAvailable:
      pa.balances.available != null ? dollarsToCents(pa.balances.available) : null,
    lastSyncedAt: now,
  });
}

// ---------------------------------------------------------------------------
// Core handler — exported for unit testing
// ---------------------------------------------------------------------------

export type ItemSyncContext = {
  event: { data: { itemId: string } };
  step: {
    run: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
    sendEvent: (id: string, events: { name: string; data: Record<string, unknown> } | { name: string; data: Record<string, unknown> }[]) => Promise<unknown>;
  };
};

export type ItemSyncResult = {
  itemId: string;
  added: number;
  modified: number;
  removed: number;
};

export async function handleItemSync(ctx: ItemSyncContext): Promise<ItemSyncResult> {
  const { itemId } = ctx.event.data;
  const { step } = ctx;

  const syncResult = await step.run('sync-transactions', async () => {
    const item = await getPlaidItemById(itemId as PlaidItemId);
    if (!item) {
      throw new NonRetriableError(`Plaid item not found: ${itemId}`);
    }

    const accessToken = await decryptSecret(item.accessTokenEnc);

    // Build a map of plaid_account_id → internal account row.
    // This will be updated as accounts are refreshed from the sync response,
    // including any new accounts that were added to the item after initial link.
    const existingAccounts = await getAccountsByPlaidItemId(item.id as PlaidItemId);
    const accountMap = new Map<string, AccountRow>(
      existingAccounts.map((a) => [a.plaidAccountId, a]),
    );

    let cursor: string | undefined = item.cursor ?? undefined;
    let hasMore = true;
    let totalAdded = 0;
    let totalModified = 0;
    let totalRemoved = 0;
    const now = new Date();

    while (hasMore) {
      const resp = await plaidClient.transactionsSync({
        access_token: accessToken,
        ...(cursor !== undefined ? { cursor } : {}),
        count: 500,
        options: { include_personal_finance_category: true },
      });

      const { added, modified, removed, next_cursor, has_more, accounts: syncAccounts } =
        resp.data;

      // Refresh/create accounts from the sync response.
      for (const pa of syncAccounts) {
        const updated = await upsertPlaidAccount(pa, item, accountMap.get(pa.account_id), now);
        accountMap.set(pa.account_id, updated);
      }

      // Upsert added transactions.
      for (const txn of added) {
        const account = accountMap.get(txn.account_id);
        if (!account) continue;
        await upsertTransaction(mapTransaction(txn, item, account));
        totalAdded++;
      }

      // Upsert modified transactions (same upsert path — keyed on plaid_transaction_id).
      for (const txn of modified) {
        const account = accountMap.get(txn.account_id);
        if (!account) continue;
        await upsertTransaction(mapTransaction(txn, item, account));
        totalModified++;
      }

      // Soft-delete removed transactions.
      for (const r of removed) {
        await softDeleteTransactionByPlaidId(r.transaction_id, now);
        totalRemoved++;
      }

      cursor = next_cursor;
      hasMore = has_more;
    }

    // Persist the final cursor so the next sync starts where this one left off.
    // cursor is always set to next_cursor in the loop above; transactionsSync
    // guarantees a non-empty next_cursor on every response.
    if (cursor === undefined) {
      throw new Error('transactionsSync returned no cursor — cannot persist sync position');
    }
    await updatePlaidItemCursor(item.id as PlaidItemId, cursor, now);

    return { added: totalAdded, modified: totalModified, removed: totalRemoved, userId: item.userId };
  });

  // Enqueue merchant normalization for any newly added/modified transactions.
  // Only emit if there is work to do; the enrichment job is idempotent but
  // skipping the event avoids unnecessary cold starts.
  if (syncResult.added + syncResult.modified > 0) {
    await step.sendEvent('enqueue-merchant-normalize', {
      name: 'enrichment/transactions.normalize',
      data: { userId: syncResult.userId },
    });
  }

  return { itemId, added: syncResult.added, modified: syncResult.modified, removed: syncResult.removed };
}

// ---------------------------------------------------------------------------
// Inngest function registration
// ---------------------------------------------------------------------------

/**
 * plaid/item.sync — triggered by the Plaid webhook handler when
 * TRANSACTIONS_SYNC_UPDATES_AVAILABLE is received.
 *
 * Runs the transactions/sync cursor loop for a single Plaid item,
 * upserting added/modified transactions and soft-deleting removed ones.
 * Persists the updated cursor for incremental syncs.
 */
export const itemSync = inngest.createFunction(
  { id: 'plaid-item-sync', name: 'Plaid Item Sync', triggers: [{ event: 'plaid/item.sync' }] },
  handleItemSync,
);
