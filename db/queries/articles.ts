import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  articles,
  categories,
  sources,
  type Article,
  type NewArticle,
} from "@/db/schema";

/**
 * Maximum number of articles any single source can contribute to the public
 * feed. Without this cap, a high-volume source (e.g. Hugging Face Blog with
 * 700+ posts) would monopolize the listing once classified. The cap is
 * applied via a `row_number()` window function partitioned by source.
 */
const PER_SOURCE_CAP = 10;

export async function insertPendingArticles(rows: NewArticle[]): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await db
    .insert(articles)
    .values(rows)
    .onConflictDoNothing({ target: articles.urlHash })
    .returning({ id: articles.id });
  return result.length;
}

export interface PendingArticle {
  id: string;
  title: string;
  url: string;
  rawExcerpt: string | null;
  language: Article["language"];
  sourceName: string;
  sourceLanguage: Article["language"];
}

/**
 * Round-robin pull from the pending queue.
 *
 * A pure `ORDER BY ingested_at ASC` (the old behaviour) drains one source
 * at a time: whichever source happens to have the oldest pending articles
 * monopolises the cron until its backlog is empty. After seeding with a
 * high-volume feed (Hugging Face: 725 pending vs. ~10–100 for the rest),
 * that meant the public home page sat at "4 sources visible" for days.
 *
 * Fix: rank each pending article *within* its source by ingestion order,
 * then sort the outer query by that rank first. With limit N, the first
 * N sources contribute one article each before we ever take a second from
 * the same source. The per-source cap on the *display* side already handled
 * monopolisation at read time; this is its mirror on the *classify* side
 * so the cap can ever fill up across more than a handful of sources.
 *
 * Trade-off: a freshly-ingested article from a quiet source can leapfrog
 * older pending articles from a noisy source. That's intentional — better
 * for the feed to look alive than to drain strictly FIFO.
 */
export async function listPendingArticles(limit: number): Promise<PendingArticle[]> {
  const ranked = db.$with("pending_ranked").as(
    db
      .select({
        id: articles.id,
        title: articles.title,
        url: articles.url,
        rawExcerpt: articles.rawExcerpt,
        // Both `articles.language` and `sources.language` exist; without
        // explicit `.as(...)` aliases Drizzle emits two bare
        // `"X"."language"` columns and Postgres rejects the CTE with
        // "column reference 'language' is ambiguous". Force distinct
        // names in the CTE projection.
        language: sql<Article["language"]>`${articles.language}`.as("article_language"),
        sourceName: sources.name,
        sourceLanguage: sql<Article["language"]>`${sources.language}`.as("source_language"),
        ingestedAt: articles.ingestedAt,
        // Rank 1 = oldest pending in its source. Tie-break on id so the
        // order is fully deterministic between calls.
        rn: sql<number>`row_number() over (
          partition by ${articles.sourceId}
          order by ${articles.ingestedAt} asc, ${articles.id} asc
        )`.as("rn"),
      })
      .from(articles)
      .innerJoin(sources, eq(sources.id, articles.sourceId))
      .where(and(eq(articles.status, "pending"), isNull(articles.classificationError))),
  );

  const rows = await db
    .with(ranked)
    .select({
      id: ranked.id,
      title: ranked.title,
      url: ranked.url,
      rawExcerpt: ranked.rawExcerpt,
      language: ranked.language,
      sourceName: ranked.sourceName,
      sourceLanguage: ranked.sourceLanguage,
    })
    .from(ranked)
    .orderBy(asc(ranked.rn), asc(ranked.ingestedAt))
    .limit(limit);
  return rows;
}

export interface ClassifiedUpdate {
  id: string;
  categoryId: string;
  titleEs: string;
  titleEn: string;
  summaryEs: string;
  summaryEn: string;
  /**
   * LLM relevance signal in [0, 1] (see `classificationSchema`). Persisted
   * from Phase 8.A onward so the broadcaster can filter. Optional for
   * callers that don't have it (eg. legacy back-fills); the DB column is
   * nullable and articles without a score stay out of broadcast.
   */
  relevanceScore?: number;
}

export async function markArticleClassified(update: ClassifiedUpdate): Promise<void> {
  await db
    .update(articles)
    .set({
      status: "classified",
      categoryId: update.categoryId,
      titleEs: update.titleEs,
      titleEn: update.titleEn,
      summaryEs: update.summaryEs,
      summaryEn: update.summaryEn,
      classificationError: null,
      relevanceScore: update.relevanceScore ?? null,
    })
    .where(eq(articles.id, update.id));
}

export async function markArticleFailed(id: string, reason: string): Promise<void> {
  await db
    .update(articles)
    .set({
      status: "failed",
      classificationError: reason.slice(0, 500),
    })
    .where(eq(articles.id, id));
}

export interface MarkArticleHiddenAsDuplicateParams {
  id: string;
  /** The full classified payload — we want it persisted even though the
   *  row will be hidden, so the operator can review the duplicate in
   *  /admin/articles and "un-hide" it if the heuristic mis-fired. */
  update: ClassifiedUpdate;
  /** ID of the existing article this one duplicates. */
  dupOfId: string;
  /** Jaccard similarity that triggered the match (for audit trail). */
  similarity: number;
}

/**
 * Persists a classified article as `hidden` because it near-duplicates
 * an earlier article. Stores the full ES/EN translations + relevance
 * score so the row carries the same data shape as a normal `classified`
 * one — the only difference is the `status` and a tag in
 * `classificationError` recording the dedupe reason.
 *
 * Tag format: `dup_of:<id>:<similarity>`. Easy to grep and lets the
 * admin UI render "duplicate of {id}" without a dedicated column.
 */
export async function markArticleHiddenAsDuplicate(
  params: MarkArticleHiddenAsDuplicateParams,
): Promise<void> {
  const tag = `dup_of:${params.dupOfId}:${params.similarity.toFixed(3)}`;
  await db
    .update(articles)
    .set({
      status: "hidden",
      categoryId: params.update.categoryId,
      titleEs: params.update.titleEs,
      titleEn: params.update.titleEn,
      summaryEs: params.update.summaryEs,
      summaryEn: params.update.summaryEn,
      relevanceScore: params.update.relevanceScore ?? null,
      classificationError: tag,
    })
    .where(eq(articles.id, params.id));
}

export interface RecentDedupeRow {
  id: string;
  /** ES title — the dedupe layer always compares against ES. */
  titleEs: string;
}

/**
 * Recent articles available for dedupe comparison. Includes both
 * `classified` and `hidden` rows so an article that was hidden as
 * dup_of:X still counts as "we already covered this event" — the next
 * candidate that matches the hidden one (e.g. third source on the same
 * story) gets caught too.
 *
 * Window defaults to 48h: long enough to span a weekend news cycle,
 * short enough to keep the comparison list small (~100 rows in
 * production).
 */
export async function listRecentForDedupe(opts: {
  sinceHours?: number;
  limit?: number;
} = {}): Promise<RecentDedupeRow[]> {
  const sinceHours = opts.sinceHours ?? 48;
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: articles.id,
      titleEs: articles.titleEs,
    })
    .from(articles)
    .where(
      and(
        inArray(articles.status, ["classified", "hidden"]),
        gte(articles.ingestedAt, since),
      ),
    )
    .orderBy(desc(articles.ingestedAt))
    .limit(limit);
  // Narrow: dedupe only uses rows that made it through classification at
  // least once (i.e. have a non-null titleEs).
  return rows
    .filter((r): r is { id: string; titleEs: string } => r.titleEs !== null);
}

export interface ListedArticle {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  imageUrl: string | null;
  sourceLanguage: Article["language"];
  publishedAt: Date;
  sourceName: string;
  categorySlug: string | null;
}

export interface ListArticlesParams {
  /** Locale to resolve title/summary to. */
  locale: "es" | "en";
  /** Category slugs to include. Empty/undefined = no filter. */
  categorySlugs?: string[];
  /** Free-text search on title + summary (locale-aware). */
  q?: string;
  /** Page size. */
  limit: number;
  /** Cursor: keyset on (publishedAt, id). Articles strictly older than this are returned. */
  cursor?: { publishedAt: Date; id: string };
}

export async function listClassifiedArticles(
  params: ListArticlesParams,
): Promise<ListedArticle[]> {
  const titleCol = params.locale === "es" ? articles.titleEs : articles.titleEn;
  const summaryCol = params.locale === "es" ? articles.summaryEs : articles.summaryEn;

  // Filters that determine the pool from which per-source ranking is computed.
  // The cap MUST live inside the ranked CTE: if it sat at the outer query it
  // would be applied after the cursor cut, and pagination could skip articles
  // that should have made the per-source top-5.
  const innerConds = [eq(articles.status, "classified")];

  if (params.categorySlugs && params.categorySlugs.length > 0) {
    innerConds.push(inArray(categories.slug, params.categorySlugs));
  }
  if (params.q && params.q.trim().length > 0) {
    const needle = `%${params.q.trim()}%`;
    const titleMatch = or(ilike(titleCol, needle), ilike(articles.title, needle));
    const summaryMatch = ilike(summaryCol, needle);
    const combined = or(titleMatch, summaryMatch);
    if (combined) innerConds.push(combined);
  }

  // CTE: rank each article within its source by recency, then we will keep
  // only the top PER_SOURCE_CAP rows per source in the outer query. This
  // prevents one high-volume source from monopolising the public feed.
  const ranked = db
    .$with("ranked")
    .as(
      db
        .select({
          id: articles.id,
          title: sql<string>`coalesce(${titleCol}, ${articles.title})`.as("title"),
          url: articles.url,
          summary: sql<string | null>`${summaryCol}`.as("summary"),
          imageUrl: articles.imageUrl,
          sourceLanguage: articles.language,
          publishedAt: articles.publishedAt,
          sourceName: sources.name,
          categorySlug: categories.slug,
          rn: sql<number>`row_number() over (
            partition by ${articles.sourceId}
            order by ${articles.publishedAt} desc, ${articles.id} desc
          )`.as("rn"),
        })
        .from(articles)
        .innerJoin(sources, eq(sources.id, articles.sourceId))
        .leftJoin(categories, eq(categories.id, articles.categoryId))
        .where(and(...innerConds)),
    );

  const outerConds = [lte(ranked.rn, PER_SOURCE_CAP)];
  if (params.cursor) {
    const cursorCond = or(
      lt(ranked.publishedAt, params.cursor.publishedAt),
      and(
        eq(ranked.publishedAt, params.cursor.publishedAt),
        lt(ranked.id, params.cursor.id),
      ),
    );
    if (cursorCond) outerConds.push(cursorCond);
  }

  const rows = await db
    .with(ranked)
    .select({
      id: ranked.id,
      title: ranked.title,
      url: ranked.url,
      summary: ranked.summary,
      imageUrl: ranked.imageUrl,
      sourceLanguage: ranked.sourceLanguage,
      publishedAt: ranked.publishedAt,
      sourceName: ranked.sourceName,
      categorySlug: ranked.categorySlug,
    })
    .from(ranked)
    .where(and(...outerConds))
    .orderBy(desc(ranked.publishedAt), desc(ranked.id))
    .limit(params.limit);

  return rows;
}

/**
 * How many articles match the current filters under the same per-source cap
 * that `listClassifiedArticles` applies. Used by the home page to display a
 * stable total ("N noticias") that does not grow as the user clicks
 * "Cargar más" — because that button only fetches a new page client-side,
 * it doesn't change the underlying total.
 *
 * Pagination (cursor / limit) is intentionally NOT applied here: we count
 * the whole filtered pool, not the visible slice.
 */
export async function countClassifiedArticles(
  params: Omit<ListArticlesParams, "limit" | "cursor">,
): Promise<number> {
  // Mirrors `listClassifiedArticles`'s inner filters exactly so the count
  // can't drift from what the listing actually shows. If you tweak the
  // filter logic there, tweak it here too.
  const titleCol = params.locale === "es" ? articles.titleEs : articles.titleEn;
  const summaryCol = params.locale === "es" ? articles.summaryEs : articles.summaryEn;

  const innerConds = [eq(articles.status, "classified")];
  if (params.categorySlugs && params.categorySlugs.length > 0) {
    innerConds.push(inArray(categories.slug, params.categorySlugs));
  }
  if (params.q && params.q.trim().length > 0) {
    const needle = `%${params.q.trim()}%`;
    const titleMatch = or(ilike(titleCol, needle), ilike(articles.title, needle));
    const summaryMatch = ilike(summaryCol, needle);
    const combined = or(titleMatch, summaryMatch);
    if (combined) innerConds.push(combined);
  }

  const ranked = db
    .$with("ranked_count")
    .as(
      db
        .select({
          rn: sql<number>`row_number() over (
            partition by ${articles.sourceId}
            order by ${articles.publishedAt} desc, ${articles.id} desc
          )`.as("rn"),
        })
        .from(articles)
        .innerJoin(sources, eq(sources.id, articles.sourceId))
        .leftJoin(categories, eq(categories.id, articles.categoryId))
        .where(and(...innerConds)),
    );

  const rows = await db
    .with(ranked)
    .select({ total: sql<number>`count(*)::int` })
    .from(ranked)
    .where(lte(ranked.rn, PER_SOURCE_CAP));

  return rows[0]?.total ?? 0;
}

export interface FeedArticle {
  id: string;
  title: string;
  summary: string | null;
  url: string;
  publishedAt: Date;
  sourceName: string;
  categorySlug: string | null;
}

/**
 * Latest classified articles, locale-resolved, intended for the public RSS feed.
 * Does not paginate — caller passes a small limit (e.g. 50).
 */
export async function listLatestForFeed(
  locale: "es" | "en",
  limit = 50,
): Promise<FeedArticle[]> {
  const titleCol = locale === "es" ? articles.titleEs : articles.titleEn;
  const summaryCol = locale === "es" ? articles.summaryEs : articles.summaryEn;

  return db
    .select({
      id: articles.id,
      title: sql<string>`coalesce(${titleCol}, ${articles.title})`,
      summary: summaryCol,
      url: articles.url,
      publishedAt: articles.publishedAt,
      sourceName: sources.name,
      categorySlug: categories.slug,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .leftJoin(categories, eq(categories.id, articles.categoryId))
    .where(eq(articles.status, "classified"))
    .orderBy(desc(articles.publishedAt), desc(articles.id))
    .limit(limit);
}

export interface CategoryFacet {
  slug: string;
  count: number;
}

export async function getCategoryFacets(): Promise<CategoryFacet[]> {
  const rows = await db
    .select({
      slug: categories.slug,
      count: sql<number>`count(${articles.id})::int`,
    })
    .from(articles)
    .innerJoin(categories, eq(categories.id, articles.categoryId))
    .where(eq(articles.status, "classified"))
    .groupBy(categories.slug)
    .orderBy(asc(categories.slug));
  return rows;
}
