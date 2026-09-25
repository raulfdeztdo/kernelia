CREATE TYPE "public"."analytics_event" AS ENUM('pageview', 'outbound', 'cta');--> statement-breakpoint
CREATE TYPE "public"."audience_channel" AS ENUM('telegram', 'mastodon', 'bluesky', 'newsletter');--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event" "analytics_event" NOT NULL,
	"path" text NOT NULL,
	"locale" "language",
	"article_id" uuid,
	"target" text,
	"referrer_host" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"country" text,
	"device" text,
	"visitor_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_date" date NOT NULL,
	"channel" "audience_channel" NOT NULL,
	"followers" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analytics_events_occurred_at_idx" ON "analytics_events" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_events_event_occurred_at_idx" ON "analytics_events" USING btree ("event","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "analytics_events_article_id_idx" ON "analytics_events" USING btree ("article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_snapshots_date_channel_unique" ON "audience_snapshots" USING btree ("snapshot_date","channel");--> statement-breakpoint
-- Same deny-by-default posture as 0013: RLS on, no policies. The app
-- talks to Postgres as `postgres` (BYPASSRLS); the anon PostgREST key
-- must not be able to read visitor hashes or forge events.
ALTER TABLE "public"."analytics_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."audience_snapshots" ENABLE ROW LEVEL SECURITY;
