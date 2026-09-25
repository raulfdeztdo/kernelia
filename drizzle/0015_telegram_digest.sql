CREATE TYPE "public"."digest_slot" AS ENUM('morning', 'afternoon');--> statement-breakpoint
ALTER TYPE "public"."cron_job" ADD VALUE 'digest';--> statement-breakpoint
CREATE TABLE "channel_digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" "broadcast_platform" NOT NULL,
	"digest_date" date NOT NULL,
	"slot" "digest_slot" NOT NULL,
	"article_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"external_id" text,
	"sent_at" timestamp with time zone,
	"cron_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channel_digests" ADD CONSTRAINT "channel_digests_cron_run_id_cron_runs_id_fk" FOREIGN KEY ("cron_run_id") REFERENCES "public"."cron_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "channel_digests_platform_date_slot_unique" ON "channel_digests" USING btree ("platform","digest_date","slot");--> statement-breakpoint
-- Same deny-by-default posture as 0013/0014.
ALTER TABLE "public"."channel_digests" ENABLE ROW LEVEL SECURITY;
