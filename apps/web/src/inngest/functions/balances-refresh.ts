import { inngest } from '@/lib/inngest';
import { plaidClient } from '@/lib/plaid';
import { decryptSecret } from '@/lib/encrypt';
import { dollarsToCents } from '@/shared/money';
import { getAllActivePlaidItems, getPlaidItemById } from '@/db/queries/plaid-items';
import { upsertAccount } from '@/db/queries/accounts';
import type { PlaidItemId, UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Core handler — exported for unit testing
// ---------------------------------------------------------------------------

export type BalancesRefreshContext = {
  step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
};

export type BalancesRefreshResult = {
  itemsRefreshed: number;
  itemsFailed: number;
};

export async function handleBalancesRefresh(
  ctx: BalancesRefreshContext,
): Promise<BalancesRefreshResult> {
  const { step } = ctx;

  // Load only the IDs to avoid storing encrypted tokens in Inngest step history.
  const itemIds = await step.run('load-active-item-ids', async () => {
    const items = await getAllActivePlaidItems();
    return items.map((i) => i.id);
  });

  let itemsRefreshed = 0;
  let itemsFailed = 0;

  for (const itemId of itemIds) {
    const result = await step.run(`refresh-balances-${itemId}`, async () => {
      const item = await getPlaidItemById(itemId as PlaidItemId);
      if (!item) return { ok: false };

      const accessToken = await decryptSecret(item.accessTokenEnc);
      const resp = await plaidClient.accountsGet({ access_token: accessToken });
      const now = new Date();

      await Promise.all(
        resp.data.accounts.map((pa) =>
          upsertAccount({
            userId: item.userId as UserId,
            plaidItemId: item.id as PlaidItemId,
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
          }),
        ),
      );

      return { ok: true };
    });

    if (result.ok) {
      itemsRefreshed++;
    } else {
      itemsFailed++;
    }
  }

  return { itemsRefreshed, itemsFailed };
}

// ---------------------------------------------------------------------------
// Inngest function registration
// ---------------------------------------------------------------------------

/**
 * plaid/balances.refresh — cron job that runs daily at 06:00 UTC.
 *
 * Calls accountsGet for every active Plaid item and upserts current
 * account balances. Processes each item as a separate Inngest step so
 * a single item failure does not prevent the rest from refreshing.
 */
export const balancesRefresh = inngest.createFunction(
  {
    id: 'plaid-balances-refresh',
    name: 'Plaid Balances Refresh',
    triggers: [{ cron: '0 6 * * *' }],
  },
  handleBalancesRefresh,
);
