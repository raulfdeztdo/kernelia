import { and, asc, desc, eq, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  articles,
  categories,
  sources,
  type Article,
  type NewArticle,
} from "@/db/schema";

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

export async function listPendingArticles(limit: number): Promise<PendingArticle[]> {
  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      rawExcerpt: articles.rawExcerpt,
      language: articles.language,
      sourceName: sources.name,
      sourceLanguage: sources.language,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .where(and(eq(articles.status, "pending"), isNull(articles.classificationError)))
    .orderBy(asc(articles.ingestedAt))
    .limit(limit);
  return rows;
}

export interface ClassifiedUpdate {
  id: string;
  categoryId: string;
  summary: string;
  language: Article["language"];
}

export async function markArticleClassified(update: ClassifiedUpdate): Promise<void> {
  await db
    .update(articles)
    .set({
      status: "classified",
      categoryId: update.categoryId,
      summary: update.summary,
      language: update.language,
      classificationError: null,
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

export interface ListedArticle {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  imageUrl: string | null;
  language: Article["language"];
  publishedAt: Date;
  sourceName: string;
  categorySlug: string | null;
}

export interface ListArticlesParams {
  /** Category slugs to include. Empty/undefined = no filter. */
  categorySlugs?: string[];
  /** Free-text search on title + summary. */
  q?: string;
  /** Page size. */
  limit: number;
  /** Cursor: keyset on (publishedAt, id). Articles strictly older than this are returned. */
  cursor?: { publishedAt: Date; id: string };
}

export async function listClassifiedArticles(
  params: ListArticlesParams,
): Promise<ListedArticle[]> {
  const conds = [eq(articles.status, "classified")];

  if (params.categorySlugs && params.categorySlugs.length > 0) {
    conds.push(inArray(categories.slug, params.categorySlugs));
  }
  if (params.q && params.q.trim().length > 0) {
    const needle = `%${params.q.trim()}%`;
    const titleMatch = ilike(articles.title, needle);
    const summaryMatch = ilike(articles.summary, needle);
    const combined = or(titleMatch, summaryMatch);
    if (combined) conds.push(combined);
  }
  if (params.cursor) {
    const cursorCond = or(
      lt(articles.publishedAt, params.cursor.publishedAt),
      and(
        eq(articles.publishedAt, params.cursor.publishedAt),
        lt(articles.id, params.cursor.id),
      ),
    );
    if (cursorCond) conds.push(cursorCond);
  }

  const rows = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      summary: articles.summary,
      imageUrl: articles.imageUrl,
      language: articles.language,
      publishedAt: articles.publishedAt,
      sourceName: sources.name,
      categorySlug: categories.slug,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .leftJoin(categories, eq(categories.id, articles.categoryId))
    .where(and(...conds))
    .orderBy(desc(articles.publishedAt), desc(articles.id))
    .limit(params.limit);

  return rows;
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
