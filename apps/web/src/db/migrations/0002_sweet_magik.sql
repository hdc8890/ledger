-- NOTE: This migration adds plaid_item_id as NOT NULL.
-- This is safe for development databases (no existing plaid_items rows).
-- If migrating a database with existing plaid_items rows, truncate the table
-- or backfill plaid_item_id values before applying this migration.
ALTER TABLE "plaid_items" ADD COLUMN "plaid_item_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_plaid_item_id_unique" UNIQUE("plaid_item_id");