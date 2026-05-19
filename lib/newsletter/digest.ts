import { and, desc, eq, gte, isNotNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { articles, categories, sources, type Locale } from "@/db/schema";
import { PUBLIC_HIDDEN_CATEGORY_SLUG } from "@/db/queries/articles";

/**
 * Newsletter digest source-of-truth.
 *
 * One call: `getWeeklyDigestArticles(locale)` → top N articles of the
 * trailing 7d, ordered by `relevanceScore desc` then `ingestedAt desc`.
 * The locale picks ES vs EN columns for the rendered title/summary; URL +
 * source name + category slug come from server-shared columns.
 *
 * Filtering rules:
 *   - `status = 'classified'`  → only LLM-validated articles.
 *   - `relevanceScore IS NOT NULL` → skip pre-Phase-8.A articles whose
 *     score was never computed (they'd otherwise sort to the top with
 *     NULLs LAST inverted).
 *   - `ingestedAt >= now - 7d` → strictly the last week, mirrors the
 *     window used by the public stats endpoint.
 */

export interface DigestArticle {
  id: string;
  url: string;
  title: string;
  summary: string | null;
  sourceName: string;
  /** Category canonical slug (e.g. "llm", "agents") — useful for the email's tag chip. */
  categorySlug: string | null;
  /** LLM relevance score in [0, 1]. Useful for debugging the sort order. */
  relevanceScore: number;
  /**
   * Article hero image as ingested from the RSS feed. May be `null` for
   * publishers that don't ship one (or where the ingester couldn't extract
   * it). The email template falls back to a text-only card in that case.
   */
  imageUrl: string | null;
  ingestedAt: Date;
}

export const WEEKLY_DIGEST_TOP_N = 10;
export const WEEKLY_DIGEST_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export async function getWeeklyDigestArticles(
  locale: Locale,
  opts: { now?: Date; topN?: number } = {},
): Promise<DigestArticle[]> {
  const now = opts.now ?? new Date();
  const topN = opts.topN ?? WEEKLY_DIGEST_TOP_N;
  const since = new Date(now.getTime() - WEEKLY_DIGEST_WINDOW_MS);

  const titleCol = locale === "es" ? articles.titleEs : articles.titleEn;
  const summaryCol = locale === "es" ? articles.summaryEs : articles.summaryEn;

  const rows = await db
    .select({
      id: articles.id,
      url: articles.url,
      title: titleCol,
      summary: summaryCol,
      sourceName: sources.name,
      categorySlug: categories.slug,
      relevanceScore: articles.relevanceScore,
      imageUrl: articles.imageUrl,
      ingestedAt: articles.ingestedAt,
    })
    .from(articles)
    .innerJoin(sources, eq(sources.id, articles.sourceId))
    .leftJoin(categories, eq(categories.id, articles.categoryId))
    .where(
      and(
        eq(articles.status, "classified"),
        // Phase 8.B: never feature `other` articles in the weekly
        // digest. Borderline LLM picks that landed on the catch-all
        // would otherwise dominate the top-N when relevanceScore ties
        // and pollute the email's "best of the week" promise.
        ne(categories.slug, PUBLIC_HIDDEN_CATEGORY_SLUG),
        isNotNull(articles.relevanceScore),
        isNotNull(titleCol),
        gte(articles.ingestedAt, since),
      ),
    )
    .orderBy(desc(articles.relevanceScore), desc(articles.ingestedAt))
    .limit(topN);

  // Drizzle widens `title` to nullable because of the JOIN — narrow + map
  // in a single pass to avoid iterating the result set twice.
  const out: DigestArticle[] = [];
  for (const r of rows) {
    if (r.title === null) continue;
    out.push({
      id: r.id,
      url: r.url,
      title: r.title,
      summary: r.summary,
      sourceName: r.sourceName,
      categorySlug: r.categorySlug,
      relevanceScore: r.relevanceScore ?? 0,
      imageUrl: r.imageUrl,
      ingestedAt: r.ingestedAt,
    });
  }
  return out;
}
