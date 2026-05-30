import { signIn } from '@/auth';

/**
 * Sign-in page — Google SSO only. Submitting the form invokes the Auth.js
 * `signIn` server action which redirects through Google's OAuth flow and back
 * to the dashboard on success.
 */
export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 p-6 dark:bg-neutral-950">
      <div className="w-full max-w-sm rounded-lg border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
        <h1 className="text-center text-2xl font-bold tracking-tight">Ledger</h1>
        <p className="mt-2 text-center text-sm text-neutral-600 dark:text-neutral-400">
          Sign in to your personal financial OS.
        </p>
        <form
          action={async () => {
            'use server';
            await signIn('google', { redirectTo: '/dashboard' });
          }}
          className="mt-8"
        >
          <button
            type="submit"
            className="flex w-full items-center justify-center rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-neutral-200"
          >
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
