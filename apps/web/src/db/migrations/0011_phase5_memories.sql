-- Phase 5 Task 1: memories and memory_proposals tables for the Memory Layer.
--
-- Requires the pgvector extension on Neon. The HNSW index on memories.embedding
-- uses vector_cosine_ops for approximate cosine-distance nearest-neighbor search.
-- Drizzle's index() builder does not support custom operator classes, so the
-- HNSW index is created here in raw SQL rather than in schema.ts.

-- Enable pgvector extension (Neon has it available; CREATE IF NOT EXISTS is idempotent).
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "public"."memory_kind" AS ENUM(
  'preference',
  'household_rule',
  'historical_context',
  'goal',
  'override_note'
);
--> statement-breakpoint

CREATE TYPE "public"."memory_proposal_status" AS ENUM(
  'pending',
  'accepted',
  'rejected'
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- memories
-- Semantic memories indexed by pgvector. Content must be free of raw amounts
-- and account identifiers — embedded text is strictly semantic.
-- ---------------------------------------------------------------------------
CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "memory_kind" NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(1536),
	"metadata" jsonb,
	"confidence" real DEFAULT 1.0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "memories"
  ADD CONSTRAINT "memories_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

-- Btree indexes for user-scoped list queries.
CREATE INDEX "memories_user_id_idx" ON "memories" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "memories_user_kind_idx" ON "memories" USING btree ("user_id", "kind");
--> statement-breakpoint

-- HNSW index for approximate nearest-neighbor cosine similarity search.
-- Only indexes rows where embedding IS NOT NULL (partial index).
-- m=16, ef_construction=64 are pgvector defaults — tune if retrieval quality degrades.
CREATE INDEX "memories_embedding_hnsw_idx"
  ON "memories"
  USING hnsw ("embedding" vector_cosine_ops)
  WHERE "embedding" IS NOT NULL;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- memory_proposals
-- Auto-extracted memory candidates pending user accept/dismiss.
-- source_session_id SET NULL on session delete so the proposal is retained.
-- ---------------------------------------------------------------------------
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

ALTER TABLE "memory_proposals"
  ADD CONSTRAINT "memory_proposals_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "memory_proposals"
  ADD CONSTRAINT "memory_proposals_source_session_id_chat_sessions_id_fk"
  FOREIGN KEY ("source_session_id") REFERENCES "public"."chat_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
--> statement-breakpoint

CREATE INDEX "memory_proposals_user_id_idx" ON "memory_proposals" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "memory_proposals_user_status_idx" ON "memory_proposals" USING btree ("user_id", "status");
--> statement-breakpoint

-- updated_at triggers (set_updated_at() function was created in migration 0000).
CREATE TRIGGER memories_set_updated_at
BEFORE UPDATE ON "memories"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

CREATE TRIGGER memory_proposals_set_updated_at
BEFORE UPDATE ON "memory_proposals"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
