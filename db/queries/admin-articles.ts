import { and, asc, desc, eq, gt, lt, or, sql, type Column } from "drizzle-orm";
import { db } from "@/db";
import {
  articles,
  categories,
  sources,
  type ArticleStatus,
} from "@/db/schema";

/**
 * Columns the admin table can sort by. Kept narrow on purpose:
 * - `publishedAt` / `ingestedAt`: the two timestamps already in the row
 *   shape; both have full datetime precision so ties are rare.
 * - `sourceName` / `categoryNameEs`: text columns from the joined tables.
 *   Lexicographic order is what an operator visually expects.
 * - `status`: enum; lexicographic order works fine here too
 *   (`classified < failed < hidden < pending`).
 * - `title`: original feed title. Useful when looking for a known piece.
 *
 * Each column has a tie-breaker on `articles.id` so pagination is
 * deterministic even when many rows share the sort key (e.g. publishing
 * platforms that floor `publishedAt` to the minute).
 */
export const ADMIN_ARTICLES_SORT_COLUMNS = [
  "publishedAt",
  "ingestedAt",
  "sourceName",
  "categoryNameEs",
  "status",
  "title",
] as const;
export type AdminArticlesSortColumn = (typeof ADMIN_ARTICLES_SORT_COLUMNS)[number];
export type AdminArticlesSortDir = "asc" | "desc";

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
  /** Column to order by. Defaults to `publishedAt`. */
  sort?: AdminArticlesSortColumn;
  /** Direction; defaults to `desc` (newest / Z-to-A first). */
  dir?: AdminArticlesSortDir;
  /**
   * Cursor for keyset pagination. Carries the value of the sort column on
   * the last row of the previous page (as a string — ISO timestamp for
   * dates, raw text for everything else) plus the row id as the tie
   * breaker. The cursor also carries the sort+dir it was generated with;
   * the caller is expected to drop the cursor if the active sort changes.
   */
  cursor?: { sortValue: string; id: string };
  /** Page size. Capped at 200. */
  limit?: number;
}

export interface AdminArticlesPage {
  rows: AdminListedArticle[];
  /** Cursor to pass back to fetch the next page, or `null` if last page. */
  nextCursor: { sortValue: string; id: string } | null;
}

/**
 * Maps each sortable column id to (drizzle column, row → cursor-string).
 * Centralised so the WHERE comparator, the ORDER BY clause and the
 * cursor encoder all agree on the same set of columns.
 */
const SORT_COLUMNS = {
  publishedAt: {
    col: articles.publishedAt,
    toCursor: (r: AdminListedArticle) => r.publishedAt.toISOString(),
  },
  ingestedAt: {
    col: articles.ingestedAt,
    toCursor: (r: AdminListedArticle) => r.ingestedAt.toISOString(),
  },
  // sourceName comes from the joined `sources` table; the alias is what
  // drizzle generates internally so `asc/desc(sources.name)` works.
  sourceName: {
    col: sources.name,
    toCursor: (r: AdminListedArticle) => r.sourceName,
  },
  categoryNameEs: {
    col: categories.nameEs,
    toCursor: (r: AdminListedArticle) => r.categoryNameEs ?? "",
  },
  status: {
    col: articles.status,
    toCursor: (r: AdminListedArticle) => r.status,
  },
  title: {
    col: articles.title,
    toCursor: (r: AdminListedArticle) => r.title,
  },
} as const satisfies Record<
  AdminArticlesSortColumn,
  { col: Column; toCursor: (r: AdminListedArticle) => string }
>;

export async function listAdminArticles(
  params: ListAdminArticlesParams = {},
): Promise<AdminArticlesPage> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const sort: AdminArticlesSortColumn = params.sort ?? "publishedAt";
  const dir: AdminArticlesSortDir = params.dir ?? "desc";
  const sortDef = SORT_COLUMNS[sort];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortCol = sortDef.col as any;
  const dirFn = dir === "asc" ? asc : desc;

  const conds = [];
  if (params.status) conds.push(eq(articles.status, params.status));
  if (params.categoryId) conds.push(eq(articles.categoryId, params.categoryId));
  if (params.sourceId) conds.push(eq(articles.sourceId, params.sourceId));
  if (params.cursor) {
    // Keyset pagination on (sortCol <dir>, id <dir>): rows strictly past
    // the cursor in the active direction, with id as tie-breaker for
    // determinism when many rows share the sort value (e.g. dates floored
    // to the minute, or category names that repeat across articles).
    //
    // For date columns we parse the cursor as ISO; everything else is
    // compared as a raw value (drizzle will coerce based on the column
    // type at SQL-emit time).
    const isDateCol = sort === "publishedAt" || sort === "ingestedAt";
    const cursorVal: Date | string = isDateCol
      ? new Date(params.cursor.sortValue)
      : params.cursor.sortValue;
    const cmpStrict = dir === "asc" ? gt : lt;
    conds.push(
      or(
        cmpStrict(sortCol, cursorVal),
        and(eq(sortCol, cursorVal), cmpStrict(articles.id, params.cursor.id)),
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
    .orderBy(dirFn(sortCol), dirFn(articles.id))
    // Over-fetch by 1 to know whether there's a next page without a count.
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const sliced = hasMore ? rows.slice(0, limit) : rows;
  const last = sliced[sliced.length - 1];
  const nextCursor =
    hasMore && last ? { sortValue: sortDef.toCursor(last), id: last.id } : null;

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
