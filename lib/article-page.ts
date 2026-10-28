import { revalidateTag, unstable_cache } from "next/cache";
import { cache } from "react";
import {
  getPublicArticleByIdRange,
  listRelatedArticles,
  type ListedArticle,
  type PublicArticle,
} from "@/db/queries/articles";
import type { Locale } from "@/i18n/routing";
import { routing } from "@/i18n/routing";
import {
  articlePath,
  articleSegment,
  parseArticleSegment,
  shortIdOf,
  shortIdRange,
} from "@/lib/permalink";
import { localizedUrl } from "@/lib/site";

/**
 * Server-side resolution of `/[locale]/n/[slug]` (Phase 9.B), shared by the
 * page, its metadata and its OG image.
 *
 * `cache()` dedupes the DB hit: `generateMetadata` and the page body run
 * in the same request and would otherwise query twice.
 *
 * `unstable_cache` (Next data cache) is the second layer. On `next start`
 * the default-locale permalinks (`/n/…`, reached via a next-intl rewrite
 * to `/es/n/…`) are rendered on demand instead of served from the ISR
 * cache; on Vercel they are cached like `/en/n/…` (measured 2026-10-28:
 * `x-vercel-cache: HIT` on both). Caching the data still keeps a render
 * from costing a Supabase query. JSON round-trips turn `Date` into
 * strings, hence the revivers below.
 *
 * TTL (phase 9.D): Next renders an ISR page again after the SHORTEST
 * `revalidate` among the segment config and every `unstable_cache` it
 * reads. The related list used to cache for 1 h, so ~10K article pages
 * re-rendered hourly for crawlers: 622K ISR writes in Oct-2026, 3x the
 * Hobby quota. Everything here now shares `ARTICLE_PAGE_TTL_S`, and the
 * changes that matter purge one page early via `revalidateArticlePage`.
 */

/**
 * Lifetime of an article page and of every data cache it reads. Keep the
 * page's `export const revalidate` equal to this (Next needs a literal
 * there). The content of a classified article doesn't change; the TTL
 * only bounds how long a change nobody purges (a cron dedupe hiding an
 * old winner, a cleanup delete) can stay visible.
 */
export const ARTICLE_PAGE_TTL_S = 7 * 86_400;

/**
 * Cache tag of an article page, keyed like the URL: by short id. Takes
 * the full article id or the short id itself.
 */
export function articleCacheTag(articleId: string): string {
  return `article:${shortIdOf(articleId)}`;
}

/**
 * Drops an article page (both locales) and its data from the cache, so
 * the next request renders it again: after the admin hides it, changes
 * its category, or a classify tick rewrites it.
 */
export function revalidateArticlePage(articleId: string): void {
  revalidateTag(articleCacheTag(articleId));
}

function revivePublic(a: PublicArticle | null): PublicArticle | null {
  return a ? { ...a, publishedAt: new Date(a.publishedAt) } : null;
}

// Built per call so the entry carries this article's tag: the tags of the
// data a page reads become the page's tags, which is what lets
// `revalidateArticlePage` purge the rendered page too.
function cachedArticleByRange(shortId: string, locale: Locale): Promise<PublicArticle | null> {
  const { lo, hi } = shortIdRange(shortId);
  return unstable_cache(
    async () => getPublicArticleByIdRange({ lo, hi }, locale),
    ["article-page:by-range", lo, hi, locale],
    { revalidate: ARTICLE_PAGE_TTL_S, tags: [articleCacheTag(shortId)] },
  )();
}

const cachedRelated = unstable_cache(
  async (locale: Locale, categorySlug: string, excludeId: string, limit: number) =>
    listRelatedArticles({ locale, categorySlug, excludeId, limit }),
  ["article-page:related"],
  // Same TTL as the page on purpose: a shorter one would make the page
  // re-render that often (see the TTL note above).
  { revalidate: ARTICLE_PAGE_TTL_S },
);

export async function getRelatedArticles(params: {
  locale: Locale;
  categorySlug: string;
  excludeId: string;
  limit: number;
}): Promise<ListedArticle[]> {
  const rows = await cachedRelated(
    params.locale,
    params.categorySlug,
    params.excludeId,
    params.limit,
  );
  return rows.map((r) => ({ ...r, publishedAt: new Date(r.publishedAt) }));
}

export type ResolvedArticle =
  | { kind: "not_found" }
  | { kind: "redirect"; to: string }
  | { kind: "ok"; article: PublicArticle; canonical: string };

export const resolveArticle = cache(
  async (locale: Locale, segment: string): Promise<ResolvedArticle> => {
    const parsed = parseArticleSegment(segment);
    if (!parsed) return { kind: "not_found" };
    const article = revivePublic(await cachedArticleByRange(parsed.shortId, locale));
    if (!article) return { kind: "not_found" };

    const expected = articleSegment(article.id, article.title);
    if (segment !== expected) {
      const path = articlePath(article.id, article.title);
      return {
        kind: "redirect",
        to: locale === routing.defaultLocale ? path : `/${locale}${path}`,
      };
    }
    return {
      kind: "ok",
      article,
      canonical: localizedUrl(locale, articlePath(article.id, article.title)),
    };
  },
);

/**
 * hreflang map. Each locale gets ITS OWN slug (the page is translated),
 * which is why this can't reuse `localeAlternates(path)`.
 */
export function articleAlternates(article: PublicArticle): Record<string, string> {
  const titles: Record<Locale, string> = {
    es: article.titleEs ?? article.originalTitle,
    en: article.titleEn ?? article.originalTitle,
  };
  const langs: Record<string, string> = {};
  for (const locale of routing.locales) {
    langs[locale] = localizedUrl(locale, articlePath(article.id, titles[locale]));
  }
  langs["x-default"] = langs[routing.defaultLocale] ?? "";
  return langs;
}
