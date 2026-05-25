-- Phase 3 Task 8: Postgres token-bucket rate limiting for POST /api/chat.
-- One row per user. Tokens are atomically consumed via INSERT...ON CONFLICT...
-- DO UPDATE with a WHERE guard; no row returned means the bucket is exhausted.

CREATE TABLE "chat_rate_limits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tokens" integer NOT NULL,
	"refilled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_rate_limits" ADD CONSTRAINT "chat_rate_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
