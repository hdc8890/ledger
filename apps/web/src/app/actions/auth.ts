'use server';

import { signOut } from '@/auth';

/**
 * Server action that ends the current Auth.js session and returns the user to
 * the sign-in page. Invoked from the client-side SignOutButton via a form.
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/sign-in' });
}
