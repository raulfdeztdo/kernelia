import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  articles,
  categories,
  sources,
  type ArticleStatus,
} from "@/db/schema";

/**
 * DB surface for the admin article-management page.
 *
 * Public listing (`db/queries/articles.ts`) is for the read-only feed and
 * filters out everything except `status='classified'`. The admin needs to
 * see ALL statuses, including `pending`, `failed` and `hidden`. Rather than
 * complicating the public listing with a `includeAll` flag, this is a
 * separate query that returns a richer row shape including the status and
 * category slug.
 */

export interface AdminListedArticle {
  id: string;
  title: string;
  url: string;
  publishedAt: Date;
  ingestedAt: Date;
  status: ArticleStatus;
  sourceId: string;
  sourceName: string;
  categoryId: string | null;
  categorySlug: string | null;
  categoryNameEs: string | null;
  // Whether the article is eligible for status='classified' transition.
  // Used by the UI to decide if the dropdown shows the option as
  // disabled vs the toast it produces.
  hasAllClassifyColumns: boolean;
}

export interface ListAdminArticlesParams {
  status?: ArticleStatus;
  categoryId?: string;
  sourceId?: string;
  /** Cursor: ISO timestamp of `published_at` of the last row of the previous page. */
  cursor?: { publishedAt: Date; id: string };
  /** Page size. Capped at 200. */
  limit?: number;
}

export interface AdminArticlesPage {
  rows: AdminListedArticle[];
  /** Cursor to pass back to fetch the next page, or `null` if last page. */
  nextCursor: { publishedAt: Date; id: string } | null;
}

export async function listAdminArticles(
  params: ListAdminArticlesParams = {},
): Promise<AdminArticlesPage> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);

  const conds = [];
  if (params.status) conds.push(eq(articles.status, params.status));
  if (params.categoryId) conds.push(eq(articles.categoryId, params.categoryId));
  if (params.sourceId) conds.push(eq(articles.sourceId, params.sourceId));
  if (params.cursor) {
    // Lexicographic cursor on (publishedAt desc, id desc): we want rows
    // strictly older than the cursor, breaking ties by id desc so the
    // pagination is deterministic across calls.
    conds.push(
      or(
        lt(articles.publishedAt, params.cursor.publishedAt),
        and(eq(articles.publishedAt, params.cursor.publishedAt), lt(articles.id, params.cursor.id)),
      )!,
    );
  }
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

  const base = db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      publishedAt: articles.publishedAt,
      ingestedAt: articles.ingestedAt,
      status: articles.status,
      sourceId: articles.sourceId,
      sourceName: sources.name,
      categoryId: articles.categoryId,
      categorySlug: categories.slug,
      categoryNameEs: categories.nameEs,
      // Pre-compute the "eligible for classified" predicate in SQL so the
      // UI doesn't have to re-do five null checks per row.
      hasAllClassifyColumns: sql<boolean>`(
        ${articles.categoryId} is not null
        and ${articles.titleEs} is not null
        and ${articles.titleEn} is not null
        and ${articles.summaryEs} is not null
        and ${articles.summaryEn} is not null
      )`,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .leftJoin(categories, eq(categories.id, articles.categoryId));

  const filtered = where ? base.where(where) : base;
  const rows = await filtered
    .orderBy(desc(articles.publishedAt), desc(articles.id))
    // Over-fetch by 1 to know whether there's a next page without a count.
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const last = sliced[sliced.length - 1];
  const nextCursor =
    hasMore && last ? { publishedAt: last.publishedAt, id: last.id } : null;

  return { rows: sliced, nextCursor };
}

/**
 * Reason codes returned to the route handler when a status transition is
 * refused. The handler maps these to 422 responses with a payload the UI
 * can render without exposing internals.
 */
export class AdminStatusError extends Error {
  constructor(
    public readonly code: "not_found" | "missing_columns",
    public readonly missingColumns?: string[],
  ) {
    super(code);
    this.name = "AdminStatusError";
  }
}

/**
 * Changes an article's status, with a guard for `classified`: the article
 * must already have all 5 columns the auto-classifier sets
 * (`categoryId`, `titleEs`, `titleEn`, `summaryEs`, `summaryEn`). The
 * other transitions are free (`pending → hidden`, `failed → pending`, etc).
 *
 * Moving to `pending` also clears `classification_error` so a retry isn't
 * confused by the previous error message.
 */
export async function adminSetArticleStatus(
  id: string,
  newStatus: ArticleStatus,
): Promise<void> {
  if (newStatus === "classified") {
    const rows = await db
      .select({
        categoryId: articles.categoryId,
        titleEs: articles.titleEs,
        titleEn: articles.titleEn,
        summaryEs: articles.summaryEs,
        summaryEn: articles.summaryEn,
      })
      .from(articles)
      .where(eq(articles.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) throw new AdminStatusError("not_found");
    const missing: string[] = [];
    if (!row.categoryId) missing.push("category_id");
    if (!row.titleEs) missing.push("title_es");
    if (!row.titleEn) missing.push("title_en");
    if (!row.summaryEs) missing.push("summary_es");
    if (!row.summaryEn) missing.push("summary_en");
    if (missing.length > 0) {
      throw new AdminStatusError("missing_columns", missing);
    }
  }

  if (newStatus === "pending") {
    await db
      .update(articles)
      .set({ status: "pending", classificationError: null })
      .where(eq(articles.id, id));
    return;
  }

  await db.update(articles).set({ status: newStatus }).where(eq(articles.id, id));
}

/**
 * Reassigns the category of a single article. `null` clears the category
 * (some `pending` articles never had one). Does NOT touch the categories
 * catalog — admins can move an article between existing slugs only.
 */
export async function adminSetArticleCategory(
  id: string,
  categoryId: string | null,
): Promise<void> {
  await db.update(articles).set({ categoryId }).where(eq(articles.id, id));
}

/**
 * Convenience shortcut: drop the article back to `pending` and clear the
 * previous error. The next cron tick will pick it up via
 * `listPendingArticles`. Equivalent to `adminSetArticleStatus(id, "pending")`
 * but kept as a distinct verb because that's how the UI exposes it.
 */
export async function adminReclassifyArticle(id: string): Promise<void> {
  await db
    .update(articles)
    .set({ status: "pending", classificationError: null })
    .where(eq(articles.id, id));
}

export interface AdminArticleSummary {
  id: string;
  title: string;
  url: string;
  status: ArticleStatus;
  categoryId: string | null;
}

/** Reads the minimal "before" snapshot for the audit log. */
export async function readAdminArticleSnapshot(
  id: string,
): Promise<AdminArticleSummary | null> {
  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      status: articles.status,
      categoryId: articles.categoryId,
    })
    .from(articles)
    .where(eq(articles.id, id))
    .limit(1);
  return rows[0] ?? null;
}
