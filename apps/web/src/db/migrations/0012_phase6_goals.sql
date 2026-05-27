-- Phase 6 Task 1 — Goal model
-- Adds: goal_kind enum, goal_status enum, goals table

DO $$ BEGIN
  CREATE TYPE "public"."goal_kind" AS ENUM(
    'save_for',
    'accelerate_debt',
    'reduce_category_spend',
    'increase_savings_rate'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."goal_status" AS ENUM(
    'active',
    'achieved',
    'archived',
    'paused'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "goals" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id"             uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "kind"                "goal_kind" NOT NULL,
  "name"                text NOT NULL,
  "target_amount_cents" bigint,
  "target_date"         date,
  "priority"            integer NOT NULL DEFAULT 0,
  "constraints"         jsonb NOT NULL DEFAULT '{}',
  "status"              "goal_status" NOT NULL DEFAULT 'active',
  "created_at"          timestamptz NOT NULL DEFAULT now(),
  "updated_at"          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "goals_user_id_idx"     ON "goals" ("user_id");
CREATE INDEX IF NOT EXISTS "goals_user_status_idx" ON "goals" ("user_id", "status");

-- Maintain updated_at automatically (set_updated_at() created in migration 0000).
CREATE TRIGGER goals_set_updated_at
BEFORE UPDATE ON "goals"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
