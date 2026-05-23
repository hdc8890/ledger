import { inngest } from '@/lib/inngest';
import { plaidClient } from '@/lib/plaid';
import { decryptSecret } from '@/lib/encrypt';
import { dollarsToCents } from '@/shared/money';
import { getAllActivePlaidItems, getPlaidItemById } from '@/db/queries/plaid-items';
import { upsertAccount } from '@/db/queries/accounts';
import type { PlaidItemId, UserId } from '@/shared/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return true if the caught error is a Plaid API error with one of the given codes.
 * Plaid SDK throws AxiosErrors; the Plaid error object lives at error.response.data.
 */
function isPlaidErrorCode(err: unknown, ...codes: string[]): boolean {
  if (err != null && typeof err === 'object' && 'response' in err) {
    const axiosLike = err as { response?: { data?: { error_code?: string } } };
    const errorCode = axiosLike.response?.data?.error_code;
    return errorCode != null && codes.includes(errorCode);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Core handler — exported for unit testing
// ---------------------------------------------------------------------------

export type InvestmentsRefreshContext = {
  step: { run: <T>(id: string, fn: () => Promise<T>) => Promise<T> };
};

export type InvestmentsRefreshResult = {
  itemsRefreshed: number;
  itemsSkipped: number;
};

export async function handleInvestmentsRefresh(
  ctx: InvestmentsRefreshContext,
): Promise<InvestmentsRefreshResult> {
  const { step } = ctx;

  // Load only IDs to avoid storing encrypted tokens in Inngest step history.
  const itemIds = await step.run('load-active-item-ids', async () => {
    const items = await getAllActivePlaidItems();
    return items.map((i) => i.id);
  });

  let itemsRefreshed = 0;
  let itemsSkipped = 0;

  for (const itemId of itemIds) {
    const result = await step.run(`refresh-investments-${itemId}`, async () => {
      const item = await getPlaidItemById(itemId as PlaidItemId);
      if (!item) return { status: 'skipped' as const };

      const accessToken = await decryptSecret(item.accessTokenEnc);

      try {
        const resp = await plaidClient.investmentsHoldingsGet({
          access_token: accessToken,
        });
        const now = new Date();

        // Update account balances from the investment holdings response.
        // Full holdings/securities data will be stored in Phase 4 when the
        // investment holdings schema is added.
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

        return { status: 'refreshed' as const };
      } catch (err: unknown) {
        // INVALID_PRODUCT / PRODUCT_NOT_READY mean this item doesn't have
        // investments enabled — skip gracefully rather than failing the step.
        if (isPlaidErrorCode(err, 'INVALID_PRODUCT', 'PRODUCT_NOT_READY', 'NO_ACCOUNTS')) {
          return { status: 'skipped' as const };
        }
        throw err;
      }
    });

    if (result.status === 'refreshed') {
      itemsRefreshed++;
    } else {
      itemsSkipped++;
    }
  }

  return { itemsRefreshed, itemsSkipped };
}

// ---------------------------------------------------------------------------
// Inngest function registration
// ---------------------------------------------------------------------------

/**
 * plaid/investments.refresh — cron job that runs daily at 07:00 UTC.
 *
 * Calls investmentsHoldingsGet for every active Plaid item. Items that do
 * not have the investment product enabled are silently skipped. Processes
 * each item as a separate Inngest step.
 *
 * Phase 1: updates account balances from the holdings response.
 * Phase 4: will also persist individual holdings and securities.
 */
export const investmentsRefresh = inngest.createFunction(
  {
    id: 'plaid-investments-refresh',
    name: 'Plaid Investments Refresh',
    triggers: [{ cron: '0 7 * * *' }],
  },
  handleInvestmentsRefresh,
);
