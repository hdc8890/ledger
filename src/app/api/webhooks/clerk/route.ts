import { headers } from 'next/headers';
import { Webhook } from 'svix';
import { upsertUserByClerkId } from '@/db/queries/users';

// ---------------------------------------------------------------------------
// Clerk webhook handler — POST /api/webhooks/clerk
//
// Clerk sends events here when user data changes. We handle `user.created`
// to ensure a `users` row exists in our DB before any other data is written.
//
// Signature verification uses svix (the library Clerk uses internally).
// Configure the webhook in the Clerk dashboard and set CLERK_WEBHOOK_SECRET.
// ---------------------------------------------------------------------------

/** Shape of the Clerk `user.created` event data we care about. */
interface ClerkUserCreatedEvent {
  type: 'user.created';
  data: {
    id: string;
  };
}

type ClerkWebhookEvent = ClerkUserCreatedEvent | { type: string; data: unknown };

export async function POST(request: Request): Promise<Response> {
  const secret = process.env['CLERK_WEBHOOK_SECRET'];
  if (!secret) {
    return new Response('Webhook secret not configured', { status: 500 });
  }

  // Svix requires these three headers for verification.
  const headerPayload = await headers();
  const svixId = headerPayload.get('svix-id');
  const svixTimestamp = headerPayload.get('svix-timestamp');
  const svixSignature = headerPayload.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('Missing svix headers', { status: 400 });
  }

  const body = await request.text();

  const wh = new Webhook(secret);
  let event: ClerkWebhookEvent;
  try {
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkWebhookEvent;
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }

  if (event.type === 'user.created') {
    const clerkId = (event as ClerkUserCreatedEvent).data.id;
    await upsertUserByClerkId({ clerkId });
    // TODO(phase-1-task-10): Once the audit_events table and insertAuditEvent
    // helper exist, record actor='system', action='user.created' here.
  }

  return new Response(null, { status: 200 });
}
