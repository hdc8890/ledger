CREATE TABLE "categorization_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"predicate" jsonb NOT NULL,
	"set_category" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categorization_rules" ADD CONSTRAINT "categorization_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "categorization_rules_user_id_idx" ON "categorization_rules" USING btree ("user_id");

-- updated_at trigger (set_updated_at() created in migration 0000).
CREATE TRIGGER categorization_rules_set_updated_at
BEFORE UPDATE ON "categorization_rules"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();