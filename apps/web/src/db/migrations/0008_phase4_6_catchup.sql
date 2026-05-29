CREATE TYPE "public"."budget_created_by" AS ENUM('user', 'ai');--> statement-breakpoint
CREATE TYPE "public"."goal_kind" AS ENUM('save_for', 'accelerate_debt', 'reduce_category_spend', 'increase_savings_rate');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'achieved', 'archived', 'paused');--> statement-breakpoint
CREATE TYPE "public"."memory_kind" AS ENUM('preference', 'household_rule', 'historical_context', 'goal', 'override_note');--> statement-breakpoint
CREATE TYPE "public"."memory_proposal_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."recurring_cadence" AS ENUM('weekly', 'biweekly', 'monthly', 'quarterly', 'annual');--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid,
	"period" date NOT NULL,
	"category" text NOT NULL,
	"cap_cents" bigint NOT NULL,
	"manual_override" boolean DEFAULT false NOT NULL,
	"created_by" "budget_created_by" DEFAULT 'ai' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_user_period_category_uniq" UNIQUE("user_id","period","category")
);
--> statement-breakpoint
CREATE TABLE "goal_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"period" date NOT NULL,
	"actual_cents" bigint NOT NULL,
	"target_cents" bigint NOT NULL,
	"on_track" boolean NOT NULL,
	"notes" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_progress_goal_period_uniq" UNIQUE("goal_id","period")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "goal_kind" NOT NULL,
	"name" text NOT NULL,
	"target_amount_cents" bigint,
	"target_date" date,
	"priority" integer DEFAULT 0 NOT NULL,
	"constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "memory_kind" NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1536),
	"metadata" jsonb,
	"confidence" real DEFAULT 1 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"proposed_text" text NOT NULL,
	"proposed_kind" text NOT NULL,
	"source_session_id" uuid,
	"status" "memory_proposal_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recurring_series_user_merchant_cadence_uniq" UNIQUE("user_id","merchant_normalized","cadence")
);
--> statement-breakpoint
CREATE TABLE "transfer_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"out_txn_id" uuid NOT NULL,
	"in_txn_id" uuid NOT NULL,
	"confidence" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_links_pair_uniq" UNIQUE("out_txn_id","in_txn_id")
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_progress" ADD CONSTRAINT "goal_progress_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_proposals" ADD CONSTRAINT "memory_proposals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_proposals" ADD CONSTRAINT "memory_proposals_source_session_id_chat_sessions_id_fk" FOREIGN KEY ("source_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_series" ADD CONSTRAINT "recurring_series_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_links" ADD CONSTRAINT "transfer_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_links" ADD CONSTRAINT "transfer_links_out_txn_id_transactions_id_fk" FOREIGN KEY ("out_txn_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_links" ADD CONSTRAINT "transfer_links_in_txn_id_transactions_id_fk" FOREIGN KEY ("in_txn_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "budgets_user_id_idx" ON "budgets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "budgets_goal_id_idx" ON "budgets" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "budgets_user_period_idx" ON "budgets" USING btree ("user_id","period");--> statement-breakpoint
CREATE INDEX "goal_progress_goal_id_idx" ON "goal_progress" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goals_user_id_idx" ON "goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "goals_user_status_idx" ON "goals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "memories_user_id_idx" ON "memories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memories_user_kind_idx" ON "memories" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "memory_proposals_user_id_idx" ON "memory_proposals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memory_proposals_user_status_idx" ON "memory_proposals" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "recurring_series_user_id_idx" ON "recurring_series" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "recurring_series_next_expected_idx" ON "recurring_series" USING btree ("user_id","next_expected_at");--> statement-breakpoint
CREATE INDEX "transfer_links_user_id_idx" ON "transfer_links" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transfer_links_out_txn_id_idx" ON "transfer_links" USING btree ("out_txn_id");--> statement-breakpoint
CREATE INDEX "transfer_links_in_txn_id_idx" ON "transfer_links" USING btree ("in_txn_id");