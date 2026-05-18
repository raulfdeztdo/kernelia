import { and, desc, eq, gte, isNotNull, notExists, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  articleBroadcasts,
  articles,
  categories,
  type BroadcastPlatform,
  type NewArticleBroadcast,
} from "@/db/schema";

/**
 * The only DB surface for `article_broadcasts`. The Phase 8.A broadcaster
 * orchestrator uses these helpers to (a) find what's eligible to publish
 * on each platform and (b) record the result so we don't double-post.
 *
 * Per-platform idempotency: the unique index on
 * `(article_id, platform)` is the contract. `recordBroadcast` relies on
 * it — a unique-violation means "another tick beat us to it" and is
 * silently swallowed.
 */

export interface PendingBroadcastArticle {
  id: string;
  titleEs: string;
  summaryEs: string | null;
  url: string;
  categorySlug: string | null;
  relevanceScore: number;
}

export interface ListPendingBroadcastParams {
  platform: BroadcastPlatform;
  /** Minimum LLM relevance score to consider. Default 0 (off). */
  minScore?: number;
  /**
   * How far back to look. Anything classified before `since` is ignored —
   * we don't want a freshly-deployed broadcaster to flood the channels
   * with a year of backlog. The cron route passes a small window
   * (e.g. last 24h).
   */
  since?: Date;
  limit?: number;
}

/**
 * Articles that are (a) classified, (b) have ES title + URL, (c) score
 * passes the threshold and the window, and (d) haven't been broadcast
 * to this specific platform yet.
 *
 * Order: oldest-classified-first by `ingested_at` so we publish in the
 * approximate order articles arrived — important for a chronological
 * channel feed.
 */
export async function listPendingForBroadcast(
  params: ListPendingBroadcastParams,
): Promise<PendingBroadcastArticle[]> {
  const minScore = params.minScore ?? 0;
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 50);
  const since = params.since ?? new Date(0); // beginning of time

  const rows = await db
    .select({
      id: articles.id,
      titleEs: articles.titleEs,
      summaryEs: articles.summaryEs,
      url: articles.url,
      categorySlug: categories.slug,
      relevanceScore: articles.relevanceScore,
    })
    .from(articles)
    .leftJoin(categories, eq(categories.id, articles.categoryId))
    .where(
      and(
        eq(articles.status, "classified"),
        isNotNull(articles.titleEs),
        isNotNull(articles.relevanceScore),
        gte(articles.relevanceScore, minScore),
        gte(articles.ingestedAt, since),
        notExists(
          db
            .select({ one: sql`1` })
            .from(articleBroadcasts)
            .where(
              and(
                eq(articleBroadcasts.articleId, articles.id),
                eq(articleBroadcasts.platform, params.platform),
              ),
            ),
        ),
      ),
    )
    .orderBy(articles.ingestedAt)
    .limit(limit);

  // Drizzle types `titleEs`/`relevanceScore` as nullable from the JOIN even
  // though our WHERE asserts they're not — narrow here so the consumer
  // shape stays clean.
  return rows.map((r) => ({
    id: r.id,
    titleEs: r.titleEs ?? "",
    summaryEs: r.summaryEs,
    url: r.url,
    categorySlug: r.categorySlug,
    relevanceScore: r.relevanceScore ?? 0,
  }));
}

export interface RecordBroadcastParams {
  articleId: string;
  platform: BroadcastPlatform;
  externalId?: string | null;
}

/**
 * Best-effort record. Returns `true` if we won the race and inserted,
 * `false` if a parallel tick already inserted for the same
 * (article, platform). The unique-violation path is the expected one
 * under concurrency and is not an error worth surfacing — the article
 * IS broadcast either way.
 */
export async function recordBroadcast(params: RecordBroadcastParams): Promise<boolean> {
  const row: NewArticleBroadcast = {
    articleId: params.articleId,
    platform: params.platform,
    externalId: params.externalId ?? null,
  };
  const inserted = await db
    .insert(articleBroadcasts)
    .values(row)
    .onConflictDoNothing({
      target: [articleBroadcasts.articleId, articleBroadcasts.platform],
    })
    .returning({ id: articleBroadcasts.id });
  return inserted.length > 0;
}

export interface RecentBroadcast {
  id: string;
  articleId: string;
  platform: BroadcastPlatform;
  postedAt: Date;
  externalId: string | null;
}

/**
 * Latest N broadcasts across all platforms, newest-first. Used by the
 * admin if we ever add a "broadcasts" page; for now the cron monitor
 * surfaces the per-tick summary which is usually enough.
 */
export async function listRecentBroadcasts(limit = 50): Promise<RecentBroadcast[]> {
  return db
    .select({
      id: articleBroadcasts.id,
      articleId: articleBroadcasts.articleId,
      platform: articleBroadcasts.platform,
      postedAt: articleBroadcasts.postedAt,
      externalId: articleBroadcasts.externalId,
    })
    .from(articleBroadcasts)
    .orderBy(desc(articleBroadcasts.postedAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

