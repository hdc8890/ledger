import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCurrentUserId } from '@/lib/auth-helpers';
import { insertPlaidItem } from '@/db/queries/plaid-items';
import { upsertAccount } from '@/db/queries/accounts';
import { insertAuditEvent } from '@/db/queries/audit-events';
import { encryptSecret } from '@/lib/encrypt';
import { plaidClient } from '@/lib/plaid';
import { dollarsToCents } from '@/shared/money';
import type { PlaidItemId } from '@/shared/types';

// ---------------------------------------------------------------------------
// POST /api/plaid/exchange
//
// Exchanges a Plaid Link public_token for an encrypted access token, then:
//   1. Stores a plaid_items row (with the encrypted token).
//   2. Fetches and upserts initial accounts from Plaid.
//   3. Writes an audit_events row for plaid.connect.
//
// The raw access_token is encrypted before hitting the DB and is never
// returned to the client or written to logs.
// ---------------------------------------------------------------------------

const ExchangeBody = z.object({
  publicToken: z.string().min(1),
  institutionId: z.string().min(1),
  institutionName: z.string().min(1),
});

export async function POST(request: Request): Promise<Response> {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Validate request body.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ExchangeBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { publicToken, institutionId, institutionName } = parsed.data;

  // Wrap the access-token exchange and all subsequent DB work in a single
  // try/catch so raw Plaid errors and stack traces never reach the client.
  // AGENTS.md §2: "raw stack traces never reach the client."
  try {
    // Exchange public token → access token (never logged, never returned).
    const exchangeRes = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });
    const accessToken = exchangeRes.data.access_token;
    const plaidItemId = exchangeRes.data.item_id;

    // Encrypt before storing — the raw token is never persisted or forwarded.
    const accessTokenEnc = await encryptSecret(accessToken);

    const item = await insertPlaidItem({
      userId,
      accessTokenEnc,
      plaidItemId,
      institutionId,
      institutionName,
      status: 'active',
      cursor: null,
      lastSyncedAt: null,
    });

    // Pull initial accounts so balances are available immediately.
    const accountsRes = await plaidClient.accountsGet({ access_token: accessToken });
    const now = new Date();

    const savedAccounts = await Promise.all(
      accountsRes.data.accounts.map((pa) =>
        upsertAccount({
          userId,
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

    await insertAuditEvent({
      actor: userId,
      action: 'plaid.connect',
      entityType: 'plaid_item',
      entityId: item.id,
      before: null,
      after: { institutionId, institutionName, accountCount: savedAccounts.length },
      source: 'user',
      confidence: null,
    });

    return NextResponse.json({
      itemId: item.id,
      accounts: savedAccounts.map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        mask: a.mask,
      })),
    });
  } catch {
    // Do not forward Plaid errors or stack traces; they may reference the access token.
    return NextResponse.json({ error: 'Failed to connect institution' }, { status: 500 });
  }
}
