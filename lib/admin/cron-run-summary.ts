import type { CronRun } from "@/db/schema";

/**
 * Server-safe one-liner renderer for the `summary` JSONB column of a
 * `cron_runs` row. Used by `/admin/cron` (server component) to
 * pre-render the collapsed cell, and re-exported through the client
 * `<CronRunRow>` for completeness — but the function itself stays
 * pure and free of any "use client" boundary, so it can be invoked
 * from either side.
 *
 * Lives outside the components/ dir on purpose: any module under a
 * client-boundary file inherits the client tag and can't be called
 * from RSC. Putting this in `lib/` keeps it truly isomorphic.
 */
export function summariseRun(run: CronRun): string {
  const s = run.summary as Record<string, unknown>;
  if (run.job === "classify") {
    const tokens = (s["tokens"] as { total?: number } | undefined)?.total ?? 0;
    return `processed=${s["processed"] ?? 0}  classified=${s["classified"] ?? 0}  dedupedHidden=${s["dedupedHidden"] ?? 0}  dedupedReplaced=${s["dedupedReplaced"] ?? 0}  hiddenNonAi=${s["hiddenNonAi"] ?? 0}  failed=${s["failed"] ?? 0}  timedOut=${s["timedOut"] ?? 0}  budgetExhausted=${s["budgetExhausted"] ?? false}  tokens=${tokens}`;
  }
  if (run.job === "broadcast") {
    if (s["skippedWindow"]) return "skippedWindow=true (fuera de ventana Europe/Madrid)";
    const posted = (s["posted"] as Record<string, number> | undefined) ?? {};
    return `mastodon=${posted["mastodon"] ?? 0}  bluesky=${posted["bluesky"] ?? 0}  telegram=${posted["telegram"] ?? 0}  failed=${s["failed"] ?? 0}  skipped=${s["skipped"] ?? 0}`;
  }
  if (run.job === "newsletter") {
    const dc = (s["digestCounts"] as { es?: number; en?: number } | undefined) ?? {};
    return `attempted=${s["attempted"] ?? 0}  sent=${s["sent"] ?? 0}  failed=${s["failed"] ?? 0}  skippedNoArticles=${s["skippedNoArticles"] ?? 0}  budgetExhausted=${s["budgetExhausted"] ?? 0}  articles[es=${dc.es ?? 0},en=${dc.en ?? 0}]`;
  }
  // ingest
  const totals = (s["totals"] as Record<string, unknown> | undefined) ?? {};
  return `fetched=${totals["fetched"] ?? 0}  inserted=${totals["inserted"] ?? 0}  failedSources=${totals["failedSources"] ?? 0}`;
}
