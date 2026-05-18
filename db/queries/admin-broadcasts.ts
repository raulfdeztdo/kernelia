import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  articleBroadcasts,
  articles,
  categories,
  type BroadcastPlatform,
} from "@/db/schema";

/**
 * Admin metrics layer for `article_broadcasts`. Drives the new
 * `/admin/broadcasts` page and the per-platform chart on the dashboard.
 *
 * Same conventions as `admin-metrics.ts`: each call is one Postgres
 * round-trip; the page fans them out via `Promise.all`.
 */

export type BroadcastPlatformValue = BroadcastPlatform;

export interface BroadcastsPerDayRow {
  /** UTC `YYYY-MM-DD`. */
  date: string;
  mastodon: number;
  bluesky: number;
  telegram: number;
  total: number;
}

/**
 * Per-platform counts grouped by UTC date over the last `days` (default 30).
 * Each missing day is filled with zeros so the chart series stays
 * `days`-long.
 */
export async function getBroadcastsPerDay(days = 30): Promise<BroadcastsPerDayRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      date: sql<string>`to_char(${articleBroadcasts.postedAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      mastodon: sql<number>`count(*) filter (where ${articleBroadcasts.platform} = 'mastodon')::int`,
      bluesky: sql<number>`count(*) filter (where ${articleBroadcasts.platform} = 'bluesky')::int`,
      telegram: sql<number>`count(*) filter (where ${articleBroadcasts.platform} = 'telegram')::int`,
    })
    .from(articleBroadcasts)
    .where(gte(articleBroadcasts.postedAt, since))
    .groupBy(sql`to_char(${articleBroadcasts.postedAt} at time zone 'UTC', 'YYYY-MM-DD')`)
    .orderBy(desc(sql`to_char(${articleBroadcasts.postedAt} at time zone 'UTC', 'YYYY-MM-DD')`));

  const byDate = new Map(rows.map((r) => [r.date, r]));
  const out: BroadcastsPerDayRow[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const row = byDate.get(key);
    const mastodon = row?.mastodon ?? 0;
    const bluesky = row?.bluesky ?? 0;
    const telegram = row?.telegram ?? 0;
    out.push({ date: key, mastodon, bluesky, telegram, total: mastodon + bluesky + telegram });
  }
  return out;
}

export interface BroadcastTotalsRow {
  platform: BroadcastPlatformValue;
  allTime: number;
  last30d: number;
  last7d: number;
  lastPostedAt: Date | null;
}

/**
 * One row per platform. Every column is a separate `count(*)` filter; the
 * three rolling windows are computed on a single table scan.
 */
export async function getBroadcastTotals(): Promise<BroadcastTotalsRow[]> {
  const now = Date.now();
  // ISO strings, not Date objects: the `postgres.js` driver doesn't accept
  // Date as a bind parameter inside a raw `sql` template (it expects
  // string/Buffer/ArrayBuffer). Drizzle's relational helpers like `gte()`
  // serialise Date themselves, but here we're filtering inside a
  // `count(*) filter (where ...)` aggregate, which has to live in a `sql`
  // template. Cast on the SQL side to keep types unambiguous.
  const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since7 = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  const rows = await db
    .select({
      platform: articleBroadcasts.platform,
      allTime: sql<number>`count(*)::int`,
      last30d: sql<number>`count(*) filter (where ${articleBroadcasts.postedAt} >= ${since30}::timestamptz)::int`,
      last7d: sql<number>`count(*) filter (where ${articleBroadcasts.postedAt} >= ${since7}::timestamptz)::int`,
      lastPostedAt: sql<Date | null>`max(${articleBroadcasts.postedAt})`,
    })
    .from(articleBroadcasts)
    .groupBy(articleBroadcasts.platform);

  const platforms: BroadcastPlatformValue[] = ["mastodon", "bluesky", "telegram"];
  const byPlatform = new Map(rows.map((r) => [r.platform, r]));
  return platforms.map((p) => {
    const row = byPlatform.get(p);
    return {
      platform: p,
      allTime: row?.allTime ?? 0,
      last30d: row?.last30d ?? 0,
      last7d: row?.last7d ?? 0,
      lastPostedAt: row?.lastPostedAt ? new Date(row.lastPostedAt) : null,
    };
  });
}

export interface BroadcastListRow {
  id: string;
  platform: BroadcastPlatformValue;
  postedAt: Date;
  externalId: string | null;
  articleId: string;
  articleTitle: string;
  articleUrl: string;
  categorySlug: string | null;
  /** LLM relevance at the time the article was classified. */
  relevanceScore: number | null;
}

export interface ListBroadcastsParams {
  /** Filter by platform — `undefined` returns all. */
  platform?: BroadcastPlatformValue;
  limit?: number;
}

/**
 * Recent broadcasts (newest-first), joined with the article they posted.
 * Used by `/admin/broadcasts` to render a sortable table.
 */
export async function listAdminBroadcasts(
  params: ListBroadcastsParams = {},
): Promise<BroadcastListRow[]> {
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const whereClauses = [];
  if (params.platform) whereClauses.push(eq(articleBroadcasts.platform, params.platform));
  const where = whereClauses.length === 0 ? undefined : and(...whereClauses);

  const base = db
    .select({
      id: articleBroadcasts.id,
      platform: articleBroadcasts.platform,
      postedAt: articleBroadcasts.postedAt,
      externalId: articleBroadcasts.externalId,
      articleId: articles.id,
      articleTitle: articles.title,
      articleUrl: articles.url,
      categorySlug: categories.slug,
      relevanceScore: articles.relevanceScore,
    })
    .from(articleBroadcasts)
    .innerJoin(articles, eq(articles.id, articleBroadcasts.articleId))
    .leftJoin(categories, eq(categories.id, articles.categoryId));

  const filtered = where ? base.where(where) : base;
  return filtered.orderBy(desc(articleBroadcasts.postedAt)).limit(limit);
}
