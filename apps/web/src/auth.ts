import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { db } from '@/lib/db';
import {
  users,
  authAccounts,
  authSessions,
  authVerificationTokens,
} from '@/db/schema';
import { isEmailAllowed } from '@/lib/auth-helpers';

// ---------------------------------------------------------------------------
// Auth.js (NextAuth v5) — Google SSO only, identity owned in our Postgres.
//
// Database session strategy: sessions/accounts live in Postgres via the
// Drizzle adapter (no JWT). The neon-http driver is fetch-based, so `auth()`
// is safe to call from edge middleware.
//
// `session.user.id` is our internal `users.id` UUID, so all existing foreign
// keys remain valid after the migration from Clerk.
// ---------------------------------------------------------------------------
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: authAccounts,
    sessionsTable: authSessions,
    verificationTokensTable: authVerificationTokens,
  }),
  session: { strategy: 'database' },
  trustHost: true,
  providers: [Google],
  pages: {
    signIn: '/sign-in',
  },
  callbacks: {
    signIn({ user }) {
      return isEmailAllowed(user.email);
    },
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
});
