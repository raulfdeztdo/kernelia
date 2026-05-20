import { and, desc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
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

/**
 * Maximum articles from a single source allowed in one digest. The
 * home feed already caps at 10/source over its full window; the digest
 * carries only 10 articles total, so the same cap would be a no-op
 * here. A tighter cap (2) keeps the email feeling curated: even a
 * source with five 0.95-relevance articles in a single week can take
 * at most 20% of the digest, leaving room for the rest of the
 * publication catalog.
 *
 * Trade-off: when a subscriber filters to a narrow category with few
 * active sources (e.g. `["robotics"]` with 3 sources), the cap caps
 * the digest length at 6. We accept that — a shorter, diverse digest
 * beats 10 same-source posts.
 */
export const WEEKLY_DIGEST_PER_SOURCE_CAP = 2;

/**
 * Phase 8.H: a normalised key for filter sets so callers can cache
 * `getWeeklyDigestArticles` results across subscribers who share the
 * same locale + category selection. Empty array → `<all>` so the
 * "no preference" case doesn't collide with any explicit filter.
 *
 * Exported so `runNewsletter` can use the SAME key for its in-memory
 * Map without forking the normalisation logic.
 */
export function digestCacheKey(locale: Locale, categorySlugs: readonly string[]): string {
  if (categorySlugs.length === 0) return `${locale}|<all>`;
  return `${locale}|${[...categorySlugs].toSorted().join(",")}`;
}

export async function getWeeklyDigestArticles(
  locale: Locale,
  opts: { now?: Date; topN?: number; categorySlugs?: readonly string[] } = {},
): Promise<DigestArticle[]> {
  const now = opts.now ?? new Date();
  const topN = opts.topN ?? WEEKLY_DIGEST_TOP_N;
  const since = new Date(now.getTime() - WEEKLY_DIGEST_WINDOW_MS);
  const categorySlugs = opts.categorySlugs ?? [];

  const titleCol = locale === "es" ? articles.titleEs : articles.titleEn;
  const summaryCol = locale === "es" ? articles.summaryEs : articles.summaryEn;

  // CTE: same filter set as before, plus a `row_number()` partitioned by
  // source so the outer query can drop everything past the per-source
  // cap. Without this, a single source with five 0.95-relevance articles
  // in a week would take 50% of the digest.
  //
  // The window function uses the SAME ordering as the outer ORDER BY
  // (`relevance_score desc, ingested_at desc`), so the survivors of the
  // cap are the strongest articles from each source — never the weak
  // ones.
  const ranked = db.$with("digest_ranked").as(
    db
      .select({
        id: articles.id,
        url: articles.url,
        title: sql<string | null>`${titleCol}`.as("title"),
        summary: sql<string | null>`${summaryCol}`.as("summary"),
        sourceName: sources.name,
        categorySlug: categories.slug,
        relevanceScore: articles.relevanceScore,
        imageUrl: articles.imageUrl,
        ingestedAt: articles.ingestedAt,
        rn: sql<number>`row_number() over (
          partition by ${articles.sourceId}
          order by ${articles.relevanceScore} desc, ${articles.ingestedAt} desc
        )`.as("rn"),
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
          // Phase 8.H: empty slug list means "no filter" — send the
          // global top-N. A non-empty list narrows the pool BEFORE the
          // top-N cut so a subscriber with only `["llm"]` selected gets
          // up to 10 LLM articles, not 10 globally-best of which 2 are
          // LLM. The `other` exclusion above still applies — it's a
          // sitewide rule, not a category preference.
          categorySlugs.length > 0
            ? inArray(categories.slug, [...categorySlugs])
            : undefined,
        ),
      ),
  );

  const rows = await db
    .with(ranked)
    .select({
      id: ranked.id,
      url: ranked.url,
      title: ranked.title,
      summary: ranked.summary,
      sourceName: ranked.sourceName,
      categorySlug: ranked.categorySlug,
      relevanceScore: ranked.relevanceScore,
      imageUrl: ranked.imageUrl,
      ingestedAt: ranked.ingestedAt,
    })
    .from(ranked)
    .where(lte(ranked.rn, WEEKLY_DIGEST_PER_SOURCE_CAP))
    .orderBy(desc(ranked.relevanceScore), desc(ranked.ingestedAt))
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
