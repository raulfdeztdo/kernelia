CREATE TYPE "public"."broadcast_platform" AS ENUM('mastodon', 'bluesky', 'telegram');--> statement-breakpoint
ALTER TYPE "public"."cron_job" ADD VALUE 'broadcast';--> statement-breakpoint
CREATE TABLE "article_broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"platform" "broadcast_platform" NOT NULL,
	"posted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "relevance_score" real;--> statement-breakpoint
ALTER TABLE "article_broadcasts" ADD CONSTRAINT "article_broadcasts_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_broadcasts_article_platform_unique" ON "article_broadcasts" USING btree ("article_id","platform");--> statement-breakpoint
CREATE INDEX "article_broadcasts_platform_posted_at_idx" ON "article_broadcasts" USING btree ("platform","posted_at" DESC NULLS LAST);