'use client';

import { signOutAction } from '@/app/actions/auth';

/**
 * Sign-out control rendered in the sidebar. Submits a form bound to the
 * `signOutAction` server action so the session cookie is cleared server-side.
 */
export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        className="rounded-md px-2 py-1 text-sm font-medium text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        Sign out
      </button>
    </form>
  );
}
