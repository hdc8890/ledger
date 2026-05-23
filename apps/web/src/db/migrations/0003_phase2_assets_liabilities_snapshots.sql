CREATE TYPE "public"."asset_kind" AS ENUM('home', 'vehicle', 'brokerage', 'cash', 'crypto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."asset_source" AS ENUM('plaid', 'api', 'user', 'ai');--> statement-breakpoint
CREATE TYPE "public"."liability_kind" AS ENUM('mortgage', 'auto', 'personal', 'student', 'credit_card', 'other');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"name" text NOT NULL,
	"value_cents" bigint NOT NULL,
	"source" "asset_source" DEFAULT 'user' NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"manual_override" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "liabilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid,
	"kind" "liability_kind" NOT NULL,
	"name" text NOT NULL,
	"balance_cents" bigint NOT NULL,
	"apr" real,
	"term_months" integer,
	"original_principal_cents" bigint,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "net_worth_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"assets_cents" bigint NOT NULL,
	"liabilities_cents" bigint NOT NULL,
	"breakdown" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "net_worth_snapshots_user_date_uniq" UNIQUE("user_id","snapshot_date")
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "is_transfer" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liabilities" ADD CONSTRAINT "liabilities_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "net_worth_snapshots" ADD CONSTRAINT "net_worth_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_user_id_idx" ON "assets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "liabilities_user_id_idx" ON "liabilities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "net_worth_snapshots_user_date_idx" ON "net_worth_snapshots" USING btree ("user_id","snapshot_date");

-- updated_at triggers for new mutable tables.
-- set_updated_at() function was created in migration 0000.
CREATE TRIGGER assets_set_updated_at
BEFORE UPDATE ON "assets"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER liabilities_set_updated_at
BEFORE UPDATE ON "liabilities"
FOR EACH ROW EXECUTE FUNCTION set_updated_at();