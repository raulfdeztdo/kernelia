import { db } from "@/db";
import { articles, type NewArticle } from "@/db/schema";

export async function insertPendingArticles(rows: NewArticle[]): Promise<number> {
  if (rows.length === 0) return 0;
  const result = await db
    .insert(articles)
    .values(rows)
    .onConflictDoNothing({ target: articles.urlHash })
    .returning({ id: articles.id });
  return result.length;
}
