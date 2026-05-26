CREATE TYPE "public"."merchant_alias_created_by" AS ENUM('seed', 'user', 'ai');--> statement-breakpoint
CREATE TABLE "chat_rate_limits" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"tokens" integer NOT NULL,
	"refilled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
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
ALTER TABLE "categorization_rules" ADD COLUMN "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_rate_limits" ADD CONSTRAINT "chat_rate_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "merchant_aliases_priority_idx" ON "merchant_aliases" USING btree ("priority");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_aliases_raw_pattern_uniq" ON "merchant_aliases" USING btree ("raw_pattern");