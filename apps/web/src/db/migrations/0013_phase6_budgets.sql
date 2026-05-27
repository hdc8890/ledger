-- Phase 6 Task 3 — Budget model
-- Adds: budget_created_by enum, budgets table

DO $$ BEGIN
  CREATE TYPE "public"."budget_created_by" AS ENUM('user', 'ai');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "budgets" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"         uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "goal_id"         uuid REFERENCES "goals"("id") ON DELETE SET NULL,
  "period"          date NOT NULL,
  "category"        text NOT NULL,
  "cap_cents"       bigint NOT NULL CHECK ("cap_cents" > 0),
  "manual_override" boolean NOT NULL DEFAULT false,
  "created_by"      "budget_created_by" NOT NULL DEFAULT 'ai',
  "created_at"      timestamptz NOT NULL DEFAULT now(),
  "updated_at"      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "budgets_user_period_category_uniq" UNIQUE ("user_id", "period", "category")
);

CREATE INDEX IF NOT EXISTS "budgets_user_id_idx"     ON "budgets" ("user_id");
CREATE INDEX IF NOT EXISTS "budgets_goal_id_idx"     ON "budgets" ("goal_id");
CREATE INDEX IF NOT EXISTS "budgets_user_period_idx" ON "budgets" ("user_id", "period");

-- Maintain updated_at automatically (set_updated_at() created in migration 0000).
CREATE TRIGGER budgets_set_updated_at
BEFORE UPDATE ON "budgets"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
