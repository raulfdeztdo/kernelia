-- Supabase linter `rls_disabled_in_public` flagged every table in the
-- `public` schema as exposed via PostgREST without RLS. The project
-- only ever talks to Postgres directly via the `postgres` role (which
-- has `BYPASSRLS`), but the Supabase REST endpoint is still reachable
-- with the project's anon key. Without RLS, anyone holding that
-- (publicly-distributable) key could read/write these tables.
--
-- Fix: enable RLS on every public table. We deliberately add NO
-- policies, which makes RLS deny-by-default for non-bypass roles
-- (anon, authenticated). The `postgres` role used by the app keeps
-- working unchanged because BYPASSRLS short-circuits the policy check.
--
-- Idempotent — `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` is a no-op
-- when RLS is already on, so re-running this migration after a
-- Supabase-side toggle stays safe.

ALTER TABLE "public"."sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."articles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."cron_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."password_reset_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."article_broadcasts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."newsletter_subscribers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."newsletter_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "public"."deleted_urls" ENABLE ROW LEVEL SECURITY;
