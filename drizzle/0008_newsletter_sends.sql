CREATE TABLE "newsletter_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"cron_run_id" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resend_id" text,
	"opened_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "newsletter_sends" ADD CONSTRAINT "newsletter_sends_subscriber_id_newsletter_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."newsletter_subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_sends" ADD CONSTRAINT "newsletter_sends_cron_run_id_cron_runs_id_fk" FOREIGN KEY ("cron_run_id") REFERENCES "public"."cron_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_sends_subscriber_id_idx" ON "newsletter_sends" USING btree ("subscriber_id");--> statement-breakpoint
CREATE INDEX "newsletter_sends_cron_run_id_idx" ON "newsletter_sends" USING btree ("cron_run_id");--> statement-breakpoint
CREATE INDEX "newsletter_sends_sent_at_desc_idx" ON "newsletter_sends" USING btree ("sent_at" DESC NULLS LAST);