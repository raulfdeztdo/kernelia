import { unstable_cache } from "next/cache";
import { cache } from "react";
import {
  getPublicArticleByIdRange,
  listRelatedArticles,
  type ListedArticle,
  type PublicArticle,
} from "@/db/queries/articles";
import type { Locale } from "@/i18n/routing";
import { routing } from "@/i18n/routing";
import { articlePath, articleSegment, parseArticleSegment, shortIdRange } from "@/lib/permalink";
import { localizedUrl } from "@/lib/site";

/**
 * Server-side resolution of `/[locale]/n/[slug]` (Phase 9.B), shared by the
 * page, its metadata and its OG image.
 *
 * `cache()` dedupes the DB hit: `generateMetadata` and the page body run
 * in the same request and would otherwise query twice.
 *
 * `unstable_cache` (Next data cache, 24h) is the second layer. The page is
 * ISR, but for the default locale the next-intl middleware reaches it via
 * a rewrite (`/n/…` → `/es/n/…`), and rewritten requests are rendered on
 * demand instead of served from the ISR cache (measured on `next start`:
 * `/en/n/…` is cached, `/n/…` is not). Caching the data keeps crawlers
 * walking thousands of Spanish permalinks from turning into thousands of
 * Supabase queries. JSON round-trips turn `Date` into strings, hence the
 * revivers below.
 */

const DATA_TTL_S = 86_400;

function revivePublic(a: PublicArticle | null): PublicArticle | null {
  return a ? { ...a, publishedAt: new Date(a.publishedAt) } : null;
}

const cachedArticleByRange = unstable_cache(
  async (lo: string, hi: string, locale: Locale) => getPublicArticleByIdRange({ lo, hi }, locale),
  ["article-page:by-range"],
  { revalidate: DATA_TTL_S },
);

const cachedRelated = unstable_cache(
  async (locale: Locale, categorySlug: string, excludeId: string, limit: number) =>
    listRelatedArticles({ locale, categorySlug, excludeId, limit }),
  ["article-page:related"],
  // Shorter: "related" should pick up today's news.
  { revalidate: 3_600 },
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
    const range = shortIdRange(parsed.shortId);
    const article = revivePublic(await cachedArticleByRange(range.lo, range.hi, locale));
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
