-- Phase 4 Task 3: transfer_links table for internal transfer detection.
-- Pairs debit (out_txn_id) with credit (in_txn_id) from different accounts
-- for the same user. Heuristic: |Δamount| < 1%, |Δdate| ≤ 3 days.
-- Both legs also get transactions.is_transfer = true for fast query exclusion.

CREATE TABLE "transfer_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"out_txn_id" uuid NOT NULL,
	"in_txn_id" uuid NOT NULL,
	"confidence" real NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "transfer_links"
  ADD CONSTRAINT "transfer_links_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "transfer_links"
  ADD CONSTRAINT "transfer_links_out_txn_id_transactions_id_fk"
  FOREIGN KEY ("out_txn_id") REFERENCES "public"."transactions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "transfer_links"
  ADD CONSTRAINT "transfer_links_in_txn_id_transactions_id_fk"
  FOREIGN KEY ("in_txn_id") REFERENCES "public"."transactions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint

ALTER TABLE "transfer_links"
  ADD CONSTRAINT "transfer_links_pair_uniq" UNIQUE ("out_txn_id", "in_txn_id");
--> statement-breakpoint

CREATE INDEX "transfer_links_user_id_idx" ON "transfer_links" USING btree ("user_id");
--> statement-breakpoint

CREATE INDEX "transfer_links_out_txn_id_idx" ON "transfer_links" USING btree ("out_txn_id");
--> statement-breakpoint

CREATE INDEX "transfer_links_in_txn_id_idx" ON "transfer_links" USING btree ("in_txn_id");
