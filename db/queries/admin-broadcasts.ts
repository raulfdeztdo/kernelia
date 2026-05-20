import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
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

/**
 * Phase 8.J: one row per ARTICLE, with per-platform broadcast cells.
 *
 * The original `listAdminBroadcasts` returns one row per (article,
 * platform) tuple — three rows for an article posted to all three
 * networks. That made the admin table noisy when the operator wanted
 * to see "where did article X go and when". This pivoted view collapses
 * each article to a single row and exposes the three platforms as
 * dedicated columns, each carrying its own `postedAt` and
 * `externalId`.
 *
 * Implementation is two round-trips: first pick the page of article
 * IDs ordered by `max(posted_at)` (with platform filter applied at the
 * broadcast level), then fetch every broadcast for those IDs joined
 * with the article. We pivot in JS rather than in SQL because the
 * Postgres pivot would need three correlated subqueries per row;
 * fetching ≤30 rows and grouping them in memory is cheaper and easier
 * to read.
 */
export interface BroadcastPerPlatformCell {
  postedAt: Date;
  externalId: string | null;
}

export interface BroadcastByArticleRow {
  articleId: string;
  articleTitle: string;
  articleUrl: string;
  categorySlug: string | null;
  /** LLM relevance at the time the article was classified. */
  relevanceScore: number | null;
  /** Newest `posted_at` across the three platform cells. Drives ORDER BY. */
  lastPostedAt: Date;
  /** Per-platform broadcast. `null` if the article wasn't posted there. */
  cells: Record<BroadcastPlatformValue, BroadcastPerPlatformCell | null>;
}

export interface ListBroadcastsByArticleParams {
  /** Articles per page. Defaults to 10. Capped at 100. */
  pageSize?: number;
  /** Zero-indexed page number. */
  page?: number;
}

export interface BroadcastsByArticlePage {
  rows: BroadcastByArticleRow[];
  /** Total matching articles (NOT broadcasts) — drives the pager. */
  total: number;
}

const PLATFORMS_LIST: readonly BroadcastPlatformValue[] = [
  "mastodon",
  "bluesky",
  "telegram",
];

export async function listAdminBroadcastsByArticle(
  params: ListBroadcastsByArticleParams = {},
): Promise<BroadcastsByArticlePage> {
  const pageSize = Math.min(Math.max(params.pageSize ?? 10, 1), 100);
  const page = Math.max(params.page ?? 0, 0);
  const offset = page * pageSize;

  // Step 1: page of article IDs ordered by their newest broadcast. We
  // also pull `max(posted_at)` so the caller can ORDER BY consistently
  // in the second round-trip (Postgres doesn't guarantee insertion
  // order out of an `inArray()` filter).
  const idRows = await db
    .select({
      articleId: articleBroadcasts.articleId,
      lastPostedAt: sql<string>`max(${articleBroadcasts.postedAt})`,
    })
    .from(articleBroadcasts)
    .groupBy(articleBroadcasts.articleId)
    .orderBy(desc(sql<string>`max(${articleBroadcasts.postedAt})`))
    .limit(pageSize)
    .offset(offset);

  // Step 2: total count for the pager. One COUNT(DISTINCT article_id)
  // so the pager total never disagrees with the rows shown.
  const totalRow = await db
    .select({
      total: sql<number>`count(distinct ${articleBroadcasts.articleId})::int`,
    })
    .from(articleBroadcasts);
  const total = totalRow[0]?.total ?? 0;

  if (idRows.length === 0) {
    return { rows: [], total };
  }

  // Step 3: fetch every broadcast for those article IDs (regardless of
  // the platform filter — once an article makes the page we want to
  // show its full posting fingerprint, not just the filtered cell).
  // Joined with the article + category so the page can render the
  // title, URL, slug and relevance score in one pass.
  const articleIds = idRows.map((r) => r.articleId);
  const broadcastsForPage = await db
    .select({
      articleId: articleBroadcasts.articleId,
      platform: articleBroadcasts.platform,
      postedAt: articleBroadcasts.postedAt,
      externalId: articleBroadcasts.externalId,
      articleTitle: articles.title,
      articleUrl: articles.url,
      categorySlug: categories.slug,
      relevanceScore: articles.relevanceScore,
    })
    .from(articleBroadcasts)
    .innerJoin(articles, eq(articles.id, articleBroadcasts.articleId))
    .leftJoin(categories, eq(categories.id, articles.categoryId))
    .where(inArray(articleBroadcasts.articleId, articleIds));

  // Pivot in memory. The two-pass design keeps the SQL trivial; pivots
  // in Postgres need correlated subqueries per platform that read worse
  // than this loop.
  const byArticle = new Map<
    string,
    {
      articleTitle: string;
      articleUrl: string;
      categorySlug: string | null;
      relevanceScore: number | null;
      cells: Record<BroadcastPlatformValue, BroadcastPerPlatformCell | null>;
    }
  >();
  for (const b of broadcastsForPage) {
    let row = byArticle.get(b.articleId);
    if (!row) {
      row = {
        articleTitle: b.articleTitle,
        articleUrl: b.articleUrl,
        categorySlug: b.categorySlug,
        relevanceScore: b.relevanceScore,
        cells: { mastodon: null, bluesky: null, telegram: null },
      };
      byArticle.set(b.articleId, row);
    }
    row.cells[b.platform] = { postedAt: b.postedAt, externalId: b.externalId };
  }

  // Reorder per the Step 1 ranking so the page presents newest-first
  // regardless of Postgres' return order in Step 3.
  const rows: BroadcastByArticleRow[] = idRows.flatMap((idRow) => {
    const r = byArticle.get(idRow.articleId);
    if (!r) return [];
    return [
      {
        articleId: idRow.articleId,
        articleTitle: r.articleTitle,
        articleUrl: r.articleUrl,
        categorySlug: r.categorySlug,
        relevanceScore: r.relevanceScore,
        lastPostedAt: new Date(idRow.lastPostedAt),
        cells: r.cells,
      },
    ];
  });

  return { rows, total };
}

/** Re-exported so the page can iterate platforms in a stable order. */
export const BROADCAST_PLATFORMS = PLATFORMS_LIST;
