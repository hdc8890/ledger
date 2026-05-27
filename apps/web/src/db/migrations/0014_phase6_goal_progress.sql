-- Phase 6 Task 5 — Progress tracking
-- Adds: goal_progress table

CREATE TABLE IF NOT EXISTS "goal_progress" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "goal_id"      uuid NOT NULL REFERENCES "goals"("id") ON DELETE CASCADE,
  "period"       date NOT NULL,
  "actual_cents" bigint NOT NULL,
  "target_cents" bigint NOT NULL,
  "on_track"     boolean NOT NULL,
  "notes"        jsonb,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "goal_progress_goal_period_uniq" UNIQUE ("goal_id", "period")
);

CREATE INDEX IF NOT EXISTS "goal_progress_goal_id_idx" ON "goal_progress" ("goal_id");
