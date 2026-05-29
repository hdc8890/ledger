import { auth } from '@/auth';
import type { UserId } from '@/shared/types';

/**
 * Resolve the authenticated user's internal UUID from the Auth.js session,
 * or `null` if the request is unauthenticated.
 *
 * This replaces the old Clerk `auth()` + `findUserByClerkId` two-step: with
 * Auth.js the Drizzle adapter owns the `users` row, so `session.user.id` is
 * already our internal `users.id` and every FK keys off it directly.
 */
export async function getCurrentUserId(): Promise<UserId | null> {
  const session = await auth();
  const id = session?.user?.id;
  return id ? (id as UserId) : null;
}

/**
 * Private-app guardrail. When `AUTH_ALLOWED_EMAILS` is set (comma-separated),
 * only those Google accounts may sign in. When it is unset/empty, all Google
 * accounts are allowed — convenient for local development.
 *
 * Pure function of its input + env so it is unit-testable without Auth.js.
 */
export function isEmailAllowed(email: string | null | undefined): boolean {
  const raw = process.env['AUTH_ALLOWED_EMAILS'];
  if (!raw || raw.trim() === '') return true;
  if (!email) return false;
  const allowed = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
  return allowed.includes(email.toLowerCase());
}
