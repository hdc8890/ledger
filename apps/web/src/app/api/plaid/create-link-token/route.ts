import { auth } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';
import { CountryCode, Products } from 'plaid';
import { findUserByClerkId } from '@/db/queries/users';
import { plaidClient } from '@/lib/plaid';

// ---------------------------------------------------------------------------
// POST /api/plaid/create-link-token
//
// Creates a Plaid Link token for the authenticated user.
// The client uses this token to open the Plaid Link widget.
// Must be called just before opening Link — tokens expire after 4 hours.
// ---------------------------------------------------------------------------

export async function POST(): Promise<Response> {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await findUserByClerkId(clerkId);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  try {
    const response = await plaidClient.linkTokenCreate({
      client_name: 'Ledger',
      language: 'en',
      country_codes: [CountryCode.Us],
      products: [Products.Transactions],
      user: { client_user_id: user.id },
    });

    return NextResponse.json({ link_token: response.data.link_token });
  } catch {
    // Do not forward Plaid error details to the client.
    return NextResponse.json({ error: 'Failed to create link token' }, { status: 500 });
  }
}
