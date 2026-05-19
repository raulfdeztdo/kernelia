ALTER TYPE "public"."cron_run_status" ADD VALUE 'running' BEFORE 'ok';--> statement-breakpoint
ALTER TABLE "article_broadcasts" ADD COLUMN "cron_run_id" uuid;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "ingested_in_run" uuid;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "classified_in_run" uuid;--> statement-breakpoint
ALTER TABLE "article_broadcasts" ADD CONSTRAINT "article_broadcasts_cron_run_id_cron_runs_id_fk" FOREIGN KEY ("cron_run_id") REFERENCES "public"."cron_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_ingested_in_run_cron_runs_id_fk" FOREIGN KEY ("ingested_in_run") REFERENCES "public"."cron_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_classified_in_run_cron_runs_id_fk" FOREIGN KEY ("classified_in_run") REFERENCES "public"."cron_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_broadcasts_cron_run_id_idx" ON "article_broadcasts" USING btree ("cron_run_id");--> statement-breakpoint
CREATE INDEX "articles_ingested_in_run_idx" ON "articles" USING btree ("ingested_in_run");--> statement-breakpoint
CREATE INDEX "articles_classified_in_run_idx" ON "articles" USING btree ("classified_in_run");