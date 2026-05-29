import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  /**
   * The session exposes our internal `users.id` UUID via `session.user.id`,
   * populated by the `session` callback in `src/auth.ts`.
   */
  interface Session {
    user: {
      id: string;
    } & DefaultSession['user'];
  }
}
