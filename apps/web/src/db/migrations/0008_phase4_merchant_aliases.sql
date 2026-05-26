-- Phase 4 Task 1: merchant_aliases table for merchant normalization pipeline.
-- Maps raw merchant strings (exact or /regex/ patterns) to canonical names.
-- Global (no user_id FK) — aliases apply to all users.
-- AI-inferred aliases are cached here (created_by='ai') to avoid repeat LLM calls.

CREATE TYPE "public"."merchant_alias_created_by" AS ENUM('seed', 'user', 'ai');
--> statement-breakpoint

CREATE TABLE "merchant_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_pattern" text NOT NULL,
	"canonical" text NOT NULL,
	"category_hint" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_by" "merchant_alias_created_by" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX "merchant_aliases_priority_idx" ON "merchant_aliases" USING btree ("priority");
--> statement-breakpoint

CREATE UNIQUE INDEX "merchant_aliases_raw_pattern_uniq" ON "merchant_aliases" ("raw_pattern");
