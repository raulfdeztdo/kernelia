import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { articles, sources, type Article, type NewArticle } from "@/db/schema";

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
