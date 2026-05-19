import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, lt, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  articles,
  categories,
  deletedUrls,
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

/**
 * Category slug that classifies cleanly but is hidden from every public
 * surface (home feed, RSS, newsletter, broadcast). The row stays in DB
 * so /admin/articles can audit it.
 *
 * Phase 8.B: paired with the LLM's `is_ai_related` gate. The classifier
 * now uses `is_ai_related: false` for non-AI noise (gadgets, gaming,
 * lifestyle) and only emits "other" for content that IS about AI but
 * doesn't fit any specific slug — we still keep "other" hidden from
 * the public to avoid the catch-all becoming a quality drag.
 */
export const PUBLIC_HIDDEN_CATEGORY_SLUG = "other";

/**
 * Phase 8.I: which of these `urlHash`es are tombstoned?
 *
 * Used by `insertPendingArticles` to drop rows the cleanup already
 * decided to nuke, even if their source feed surfaces them again
 * later. The unique-constraint on `articles.url_hash` alone can't
 * cover this — once we hard-delete a row the constraint stops firing,
 * and the next ingest would happily re-insert. The tombstone table is
 * the only durable record of "we decided this URL doesn't belong here".
 *
 * Returns a Set for O(1) membership tests in the caller's filter step.
 */
export async function listTombstonedHashes(urlHashes: string[]): Promise<Set<string>> {
  if (urlHashes.length === 0) return new Set();
  const rows = await db
    .select({ urlHash: deletedUrls.urlHash })
    .from(deletedUrls)
    .where(inArray(deletedUrls.urlHash, urlHashes));
  return new Set(rows.map((r) => r.urlHash));
}

export interface InsertPendingArticlesResult {
  /** Rows that actually made it to the table (excludes both unique-key conflicts and tombstoned URLs). */
  inserted: number;
  /** How many of the input rows were rejected because their URL is tombstoned. Pure observability — surfaces in the ingest summary. */
  skippedTombstoned: number;
}

export async function insertPendingArticles(
  rows: NewArticle[],
): Promise<InsertPendingArticlesResult> {
  if (rows.length === 0) return { inserted: 0, skippedTombstoned: 0 };

  // Pre-filter against tombstones BEFORE the INSERT so a re-published
  // URL doesn't even reach the unique-key check. The lookup is one
  // round-trip but pays for itself by avoiding a bunch of
  // INSERT … ON CONFLICT DO NOTHING calls that would otherwise burn
  // sequence ids on rejected rows.
  const tombstoned = await listTombstonedHashes(rows.map((r) => r.urlHash));
  const cleaned = tombstoned.size === 0 ? rows : rows.filter((r) => !tombstoned.has(r.urlHash));

  if (cleaned.length === 0) {
    return { inserted: 0, skippedTombstoned: tombstoned.size };
  }

  const result = await db
    .insert(articles)
    .values(cleaned)
    .onConflictDoNothing({ target: articles.urlHash })
    .returning({ id: articles.id });
  return { inserted: result.length, skippedTombstoned: tombstoned.size };
}

export interface PendingArticle {
  id: string;
  title: string;
  url: string;
  rawExcerpt: string | null;
  /** Image URL ingested from the RSS feed, if any. Used by the dedupe
   *  branch in `runClassify` to prefer the version with an image when a
   *  near-duplicate match is found. */
  imageUrl: string | null;
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
        imageUrl: articles.imageUrl,
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
      imageUrl: ranked.imageUrl,
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

export async function markArticleClassified(
  update: ClassifiedUpdate,
  cronRunId: string | null = null,
): Promise<void> {
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
      // Phase 8.D: stamp the tick that produced this classification.
      // A reclassify (manual or scheduled) overwrites the previous
      // value, which is what we want — the admin detail shows the
      // most recent attribution.
      classifiedInRun: cronRunId,
    })
    .where(eq(articles.id, update.id));
}

export async function markArticleFailed(
  id: string,
  reason: string,
  cronRunId: string | null = null,
): Promise<void> {
  await db
    .update(articles)
    .set({
      status: "failed",
      classificationError: reason.slice(0, 500),
      classifiedInRun: cronRunId,
    })
    .where(eq(articles.id, id));
}

/**
 * Hides an article that the classifier flagged as `is_ai_related: false`
 * (Phase 8.B). The full ES/EN payload is still persisted so the operator
 * can review the decision in /admin/articles and un-hide it if the LLM
 * mis-fired on a borderline case.
 *
 * Tag: `non_ai` — grep-able from cron logs and the admin UI.
 */
export async function markArticleHiddenAsNonAi(
  params: { id: string; update: ClassifiedUpdate; cronRunId?: string | null },
): Promise<void> {
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
      classificationError: "non_ai",
      classifiedInRun: params.cronRunId ?? null,
    })
    .where(eq(articles.id, params.id));
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
  /** Phase 8.D: cron tick that produced the dedupe decision. */
  cronRunId?: string | null;
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
      classifiedInRun: params.cronRunId ?? null,
    })
    .where(eq(articles.id, params.id));
}

export interface ClassifyReplacingDuplicateParams {
  /** The new article that will become the cluster winner. */
  newId: string;
  newUpdate: ClassifiedUpdate;
  /** The previously-classified article that loses the slot. */
  oldId: string;
  /** Jaccard similarity for the audit tag. */
  similarity: number;
  /** Phase 8.D: cron tick that produced the swap. */
  cronRunId?: string | null;
}

/**
 * Atomic swap: classify the new article AND hide the old one in a single
 * transaction so the cluster never has 0 or 2 visible winners at any
 * point. The old row is tagged `dup_replaced_by:<newId>:<similarity>`
 * so the admin UI / operator can trace why it disappeared.
 *
 * Triggered when the new article has an image and the old one doesn't —
 * see `lib/ai/run.ts`. For all other tie / no-image cases, we fall back
 * to `markArticleHiddenAsDuplicate` (FIFO, the existing path).
 */
export async function classifyReplacingDuplicate(
  params: ClassifyReplacingDuplicateParams,
): Promise<void> {
  const tag = `dup_replaced_by:${params.newId}:${params.similarity.toFixed(3)}`;
  const runId = params.cronRunId ?? null;
  await db.transaction(async (tx) => {
    // 1. Hide the old winner first. If this throws (e.g. row gone),
    //    we bail before touching the new one — better to leave the new
    //    one pending for the next tick than to publish two duplicates.
    await tx
      .update(articles)
      .set({ status: "hidden", classificationError: tag, classifiedInRun: runId })
      .where(eq(articles.id, params.oldId));
    // 2. Promote the new article to classified.
    await tx
      .update(articles)
      .set({
        status: "classified",
        categoryId: params.newUpdate.categoryId,
        titleEs: params.newUpdate.titleEs,
        titleEn: params.newUpdate.titleEn,
        summaryEs: params.newUpdate.summaryEs,
        summaryEn: params.newUpdate.summaryEn,
        classificationError: null,
        relevanceScore: params.newUpdate.relevanceScore ?? null,
        classifiedInRun: runId,
      })
      .where(eq(articles.id, params.newId));
  });
}

export interface RecentDedupeRow {
  id: string;
  /** ES title — the dedupe layer always compares against ES. */
  titleEs: string;
  /** Image URL of the recent article, if any. Used to decide whether an
   *  incoming match should REPLACE this one as the cluster winner. */
  imageUrl: string | null;
  /** Whether this recent row is the current "winner" (status='classified')
   *  for its cluster. Replace logic only swaps against classified rows —
   *  we never resurrect a hidden one. */
  isClassified: boolean;
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
      imageUrl: articles.imageUrl,
      status: articles.status,
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
  const out: RecentDedupeRow[] = [];
  for (const r of rows) {
    if (r.titleEs === null) continue;
    out.push({
      id: r.id,
      titleEs: r.titleEs,
      imageUrl: r.imageUrl,
      isClassified: r.status === "classified",
    });
  }
  return out;
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
  const innerConds = [
    eq(articles.status, "classified"),
    // Phase 8.B: keep `other` out of the public feed. See
    // `PUBLIC_HIDDEN_CATEGORY_SLUG` above.
    ne(categories.slug, PUBLIC_HIDDEN_CATEGORY_SLUG),
  ];

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

  const innerConds = [
    eq(articles.status, "classified"),
    ne(categories.slug, PUBLIC_HIDDEN_CATEGORY_SLUG),
  ];
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
    .where(
      and(
        eq(articles.status, "classified"),
        ne(categories.slug, PUBLIC_HIDDEN_CATEGORY_SLUG),
      ),
    )
    .orderBy(desc(articles.publishedAt), desc(articles.id))
    .limit(limit);
}

export interface CategoryFacet {
  slug: string;
  count: number;
}

/**
 * Hard-deletes articles with `status IN ('failed', 'hidden')` ingested
 * before `cutoff`. Cascades via `ON DELETE CASCADE` on
 * `article_broadcasts.article_id` (and `newsletter_sends` doesn't
 * reference `articles`, so nothing else to clean up).
 *
 * Returns the count of rows deleted. Used by the daily `cleanup`
 * cron tick (Phase 8.F) to stop the table from growing unbounded
 * with classifier mis-fires (`classification_error = 'non_ai'`),
 * dedupe hides (`dup_of:*`, `dup_replaced_by:*`) and LLM errors.
 *
 * We intentionally do NOT delete `status = 'classified'` rows —
 * those are visible (or could become visible if reclassified) and
 * deleting them would corrupt the public feed history. Pending rows
 * are also preserved because the next classify tick still needs them.
 *
 * The `RETURNING id` shape gives us a deterministic count without a
 * separate SELECT round-trip.
 */
export interface HardDeleteResult {
  deleted: number;
  /** First 10 ids — a breadcrumb the admin sees in the cron-run summary. */
  sample: string[];
  /** Number of tombstones written (= `deleted` minus any inserts that the tombstone table already had). */
  tombstoned: number;
}

/**
 * Phase 8.I: shared "delete-then-tombstone" primitive.
 *
 * Every hard-delete in this codebase has to also leave a tombstone, or
 * the next ingest will undo our work. We factor that pairing into one
 * helper that takes the WHERE expression, runs the DELETE with `RETURNING
 * id, url, url_hash`, and then INSERTs every (hash, url) into
 * `deleted_urls` with the caller's reason tag.
 *
 * The insert uses `ON CONFLICT DO NOTHING` because a previous delete
 * might already have tombstoned the same hash (e.g. a re-ingested URL
 * was tombstoned, slipped through somehow, then hard-deleted again).
 * In that case the `tombstoned` count under-reports by 1; that's only
 * a metric, never a correctness signal.
 *
 * Doing this in two statements (DELETE then INSERT) rather than one
 * data-modifying CTE is on purpose: the postgres-js driver pipelines
 * them in the same connection so the latency cost is one round-trip,
 * and the two-statement shape stays readable in straight Drizzle.
 */
async function hardDeleteWithTombstone(
  whereExpr: ReturnType<typeof and> | undefined,
  reason: string,
  cronRunId: string | null,
): Promise<HardDeleteResult> {
  const deletedRows = await db
    .delete(articles)
    .where(whereExpr)
    .returning({ id: articles.id, url: articles.url, urlHash: articles.urlHash });

  if (deletedRows.length === 0) {
    return { deleted: 0, sample: [], tombstoned: 0 };
  }

  const tombstoneRows = deletedRows.map((r) => ({
    urlHash: r.urlHash,
    url: r.url,
    reason,
    deletedInRun: cronRunId,
  }));
  const tombstoneInserts = await db
    .insert(deletedUrls)
    .values(tombstoneRows)
    .onConflictDoNothing({ target: deletedUrls.urlHash })
    .returning({ urlHash: deletedUrls.urlHash });

  return {
    deleted: deletedRows.length,
    sample: deletedRows.slice(0, 10).map((r) => r.id),
    tombstoned: tombstoneInserts.length,
  };
}

export async function hardDeleteOldNonClassifiedArticles(
  cutoff: Date,
  options: { cronRunId?: string | null } = {},
): Promise<HardDeleteResult> {
  return hardDeleteWithTombstone(
    and(
      inArray(articles.status, ["failed", "hidden"]),
      lt(articles.ingestedAt, cutoff),
    ),
    "retention_failed_or_hidden",
    options.cronRunId ?? null,
  );
}

/**
 * Phase 8.I: hard-deletes any article whose `published_at` predates the
 * cutoff, regardless of status. Used to enforce the calendar-year
 * retention rule (`< currentYear - 2`).
 *
 * Unlike `hardDeleteOldNonClassifiedArticles` this DOES delete
 * `status = 'classified'` rows — a legitimate article from 2022 that's
 * been in the feed for two+ years is exactly what we want to purge.
 * CASCADE on `article_broadcasts.article_id` takes the broadcast
 * history with it (we discussed the trade-off and accepted it).
 *
 * The tombstones make sure a source that re-publishes an old URL
 * doesn't drag it back into the feed during the next ingest tick.
 */
export async function hardDeleteArticlesPublishedBefore(
  cutoff: Date,
  options: { cronRunId?: string | null } = {},
): Promise<HardDeleteResult> {
  return hardDeleteWithTombstone(
    and(lt(articles.publishedAt, cutoff)),
    "retention_published_year",
    options.cronRunId ?? null,
  );
}

export interface CronRunArticle {
  id: string;
  title: string;
  url: string;
  status: Article["status"];
  /** Localised slug (might be NULL on rows that ingested but never classified). */
  categorySlug: string | null;
  sourceName: string;
  /** `null` for ingest-stage rows that never got classified. */
  relevanceScore: number | null;
  /** Reason tag from `classificationError` (e.g. `non_ai`, `dup_of:<id>`). */
  classificationError: string | null;
  /** `ingestedAt` for stage='ingested', null otherwise. */
  ingestedAt: Date | null;
}

/**
 * Lists every article touched by a given cron tick. Used by the
 * admin /admin/cron expand-row detail view. The `stage` param selects
 * which FK column to filter on:
 *
 *   - `ingested`: rows the ingest tick first inserted (matches
 *     `articles.ingested_in_run`).
 *   - `classified`: rows the classify tick updated (matches
 *     `articles.classified_in_run`) — includes status='classified',
 *     'hidden' (dedupe / non_ai), and 'failed'.
 *
 * Ordered by `ingestedAt desc` so the most recent items sit on top —
 * the same ordering the admin articles table uses by default.
 */
export async function listArticlesByCronRun(
  runId: string,
  stage: "ingested" | "classified",
): Promise<CronRunArticle[]> {
  const filterCol = stage === "ingested" ? articles.ingestedInRun : articles.classifiedInRun;
  const rows = await db
    .select({
      id: articles.id,
      title: sql<string>`coalesce(${articles.titleEs}, ${articles.title})`,
      url: articles.url,
      status: articles.status,
      categorySlug: categories.slug,
      sourceName: sources.name,
      relevanceScore: articles.relevanceScore,
      classificationError: articles.classificationError,
      ingestedAt: articles.ingestedAt,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .leftJoin(categories, eq(categories.id, articles.categoryId))
    .where(eq(filterCol, runId))
    .orderBy(desc(articles.ingestedAt))
    .limit(500);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    url: r.url,
    status: r.status,
    categorySlug: r.categorySlug,
    sourceName: r.sourceName,
    relevanceScore: r.relevanceScore,
    classificationError: r.classificationError,
    ingestedAt: stage === "ingested" ? r.ingestedAt : null,
  }));
}

/**
 * Counts per category, matching exactly what the home feed would
 * render if the user clicked that category chip.
 *
 * The naive count (every classified row whose slug = X) overstates
 * the number because the public feed applies a `PER_SOURCE_CAP=10`
 * via a `row_number()` window — a noisy source that emits 200 LLM
 * articles only contributes 10 of them to the visible feed. We
 * mirror that exact transformation here so "LLM: 47" in the badge
 * equals 47 visible articles after filtering, not 47 rows in DB.
 *
 * SQL shape:
 *
 *   WITH ranked AS (
 *     SELECT c.slug,
 *       row_number() OVER (
 *         PARTITION BY c.slug, a.source_id
 *         ORDER BY a.published_at DESC, a.id DESC
 *       ) AS rn
 *     FROM articles a
 *     INNER JOIN categories c ON c.id = a.category_id
 *     WHERE a.status = 'classified' AND c.slug != 'other'
 *   )
 *   SELECT slug, COUNT(*) FROM ranked WHERE rn <= 10 GROUP BY slug;
 *
 * Partitioning by `(slug, source_id)` is the key insight: filtering
 * by category and then capping per source (what `listClassifiedArticles`
 * does at read time) is mathematically the same as capping within
 * each (category, source) cell. We compute all the cells once and
 * sum.
 */
export async function getCategoryFacets(): Promise<CategoryFacet[]> {
  const ranked = db.$with("category_facet_ranked").as(
    db
      .select({
        slug: categories.slug,
        rn: sql<number>`row_number() over (
          partition by ${categories.slug}, ${articles.sourceId}
          order by ${articles.publishedAt} desc, ${articles.id} desc
        )`.as("rn"),
      })
      .from(articles)
      .innerJoin(categories, eq(categories.id, articles.categoryId))
      .where(
        and(
          eq(articles.status, "classified"),
          ne(categories.slug, PUBLIC_HIDDEN_CATEGORY_SLUG),
        ),
      ),
  );

  const rows = await db
    .with(ranked)
    .select({
      slug: ranked.slug,
      count: sql<number>`count(*)::int`,
    })
    .from(ranked)
    .where(lte(ranked.rn, PER_SOURCE_CAP))
    .groupBy(ranked.slug)
    .orderBy(asc(ranked.slug));
  return rows;
}
