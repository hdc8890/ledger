import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// users
// Top-level identity row, keyed on Clerk's user ID.
// Created via the /api/webhooks/clerk handler on first sign-in.
// ---------------------------------------------------------------------------
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  /** Household the user belongs to — null until household is created. */
  householdId: uuid('household_id'),
  /** Feature flags and preferences: { flags: Record<string, boolean>, timezone: string } */
  settings: jsonb('settings').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
