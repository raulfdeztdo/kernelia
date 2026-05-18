import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { articles, categories, cronRuns, sources } from "@/db/schema";

/**
 * Public stats probe. Server-only.
 *
 * Drives both the public `/api/stats` endpoint (no-auth, CORS-open) and the
 * `/stats` page. Same shape goes to both surfaces so third-party scrapers
 * and Kernelia itself never diverge.
 *
 * Contract: no PII, no per-article fields, no admin-only signals. Anything
 * here is scrapeable by anyone — design accordingly.
 */

export interface PublicStats {
  articles: {
    /** Articles that survived the LLM and are visible on the public feed. */
    classified: number;
    /** Subset of `classified` whose `ingested_at` is within the last 7d. */
    classifiedLast7d: number;
  };
  sources: {
    /** Sources with `active = true` — the ones the ingest cron polls. */
    active: number;
  };
  categories: {
    /** Total category rows. Should equal the constant `CATEGORY_SLUGS.length`. */
    total: number;
  };
  tokens: {
    /** Sum of `cron_runs.summary.tokens.total` for the last 30 UTC days. */
    last30dTotal: number;
  };
  lastIngestAt: string | null;
  lastClassifyAt: string | null;
  /** Wall-clock when this snapshot was rendered (ISO). */
  generatedAt: string;
}

/**
 * Single Postgres round-trip per metric — fans them out via `Promise.all`.
 * `lastIngestAt` and `lastClassifyAt` read from `cron_runs` (the operational
 * truth) instead of inferring from `articles`: a cron tick that found
 * nothing new still counts as "the system is alive".
 */
export async function getPublicStats(): Promise<PublicStats> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    classifiedRows,
    classifiedLast7dRows,
    activeSourcesRows,
    categoryRows,
    tokenRows,
    lastIngestRows,
    lastClassifyRows,
  ] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(articles)
      .where(eq(articles.status, "classified")),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(articles)
      .where(and(eq(articles.status, "classified"), gte(articles.ingestedAt, sevenDaysAgo))),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(sources)
      .where(eq(sources.active, true)),
    db.select({ n: sql<number>`count(*)::int` }).from(categories),
    db
      .select({
        total: sql<number>`coalesce(sum(((${cronRuns.summary}->'tokens'->>'total')::int)), 0)::int`,
      })
      .from(cronRuns)
      .where(and(eq(cronRuns.job, "classify"), gte(cronRuns.startedAt, thirtyDaysAgo))),
    db
      .select({ at: cronRuns.finishedAt })
      .from(cronRuns)
      .where(and(eq(cronRuns.job, "ingest"), eq(cronRuns.status, "ok")))
      .orderBy(desc(cronRuns.finishedAt))
      .limit(1),
    db
      .select({ at: cronRuns.finishedAt })
      .from(cronRuns)
      .where(and(eq(cronRuns.job, "classify"), eq(cronRuns.status, "ok")))
      .orderBy(desc(cronRuns.finishedAt))
      .limit(1),
  ]);

  return {
    articles: {
      classified: classifiedRows[0]?.n ?? 0,
      classifiedLast7d: classifiedLast7dRows[0]?.n ?? 0,
    },
    sources: { active: activeSourcesRows[0]?.n ?? 0 },
    categories: { total: categoryRows[0]?.n ?? 0 },
    tokens: { last30dTotal: tokenRows[0]?.total ?? 0 },
    lastIngestAt: lastIngestRows[0]?.at ? lastIngestRows[0].at.toISOString() : null,
    lastClassifyAt: lastClassifyRows[0]?.at ? lastClassifyRows[0].at.toISOString() : null,
    generatedAt: new Date().toISOString(),
  };
}
