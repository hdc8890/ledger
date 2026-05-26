-- Phase 4 Task 4: recurring_series table for recurring bill detection.
-- One row per (user_id, merchant_normalized, cadence) — UNIQUE constraint
-- makes upserts idempotent. No FK to transactions (derived aggregate).
-- Cascades on user deletion.

CREATE TYPE "public"."recurring_cadence" AS ENUM(
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'annual'
);
--> statement-breakpoint

CREATE TABLE "recurring_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"merchant_normalized" text NOT NULL,
	"cadence" "recurring_cadence" NOT NULL,
	"expected_amount_cents" bigint NOT NULL,
	"amount_tolerance_pct" real DEFAULT 0.1 NOT NULL,
	"next_expected_at" date,
	"last_seen_at" date NOT NULL,
	"confidence" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "recurring_series"
  ADD CONSTRAINT "recurring_series_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "recurring_series"
  ADD CONSTRAINT "recurring_series_user_merchant_cadence_uniq"
  UNIQUE ("user_id", "merchant_normalized", "cadence");
--> statement-breakpoint

CREATE INDEX "recurring_series_user_id_idx" ON "recurring_series" USING btree ("user_id");
--> statement-breakpoint

CREATE INDEX "recurring_series_next_expected_idx" ON "recurring_series" USING btree ("user_id", "next_expected_at");
