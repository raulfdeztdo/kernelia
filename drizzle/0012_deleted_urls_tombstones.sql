CREATE TABLE "deleted_urls" (
	"url_hash" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"deleted_in_run" uuid
);
--> statement-breakpoint
ALTER TABLE "deleted_urls" ADD CONSTRAINT "deleted_urls_deleted_in_run_cron_runs_id_fk" FOREIGN KEY ("deleted_in_run") REFERENCES "public"."cron_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deleted_urls_deleted_at_idx" ON "deleted_urls" USING btree ("deleted_at" DESC NULLS LAST);