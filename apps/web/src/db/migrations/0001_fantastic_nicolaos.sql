CREATE TYPE "public"."audit_source" AS ENUM('user', 'ai', 'system', 'rule');--> statement-breakpoint
CREATE TYPE "public"."category_source" AS ENUM('plaid', 'ai', 'user', 'rule');--> statement-breakpoint
CREATE TYPE "public"."plaid_item_status" AS ENUM('active', 'disconnected', 'error');--> statement-breakpoint
CREATE TYPE "public"."transaction_source" AS ENUM('plaid', 'csv', 'manual');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plaid_item_id" uuid NOT NULL,
	"plaid_account_id" text NOT NULL,
	"name" text NOT NULL,
	"official_name" text,
	"mask" text,
	"type" text NOT NULL,
	"subtype" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"balance_current" bigint NOT NULL,
	"balance_available" bigint,
	"last_synced_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_plaid_account_id_unique" UNIQUE("plaid_account_id")
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"source" "audit_source" NOT NULL,
	"confidence" real,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plaid_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token_enc" text NOT NULL,
	"institution_id" text NOT NULL,
	"institution_name" text NOT NULL,
	"status" "plaid_item_status" DEFAULT 'active' NOT NULL,
	"cursor" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"plaid_transaction_id" text,
	"posted_at" date NOT NULL,
	"authorized_at" date,
	"amount_cents" bigint NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"merchant_raw" text NOT NULL,
	"merchant_normalized" text,
	"category" text,
	"category_source" "category_source",
	"category_confidence" real,
	"pending" boolean DEFAULT false NOT NULL,
	"source" "transaction_source" DEFAULT 'plaid' NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transactions_plaid_transaction_id_unique" UNIQUE("plaid_transaction_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_plaid_item_id_plaid_items_id_fk" FOREIGN KEY ("plaid_item_id") REFERENCES "public"."plaid_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plaid_items" ADD CONSTRAINT "plaid_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "accounts_plaid_item_id_idx" ON "accounts" USING btree ("plaid_item_id");--> statement-breakpoint
CREATE INDEX "audit_events_entity_id_idx" ON "audit_events" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "plaid_items_user_id_idx" ON "plaid_items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_user_id_idx" ON "transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "transactions_account_id_idx" ON "transactions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "transactions_user_posted_idx" ON "transactions" USING btree ("user_id","posted_at");

-- updated_at triggers for new mutable tables.
-- set_updated_at() function was created in migration 0000.
CREATE TRIGGER plaid_items_set_updated_at
BEFORE UPDATE ON "plaid_items"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER accounts_set_updated_at
BEFORE UPDATE ON "accounts"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER transactions_set_updated_at
BEFORE UPDATE ON "transactions"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();