import type { MetadataRoute } from "next";
import type { SitemapArticle } from "@/db/queries/articles";
import { routing, type Locale } from "@/i18n/routing";
import { articlePath } from "@/lib/permalink";
import { localizedUrl } from "@/lib/site";

/**
 * Phase 9.B: one entry per (article, locale). Each locale has its own
 * slug, so the hreflang map is built per article rather than with
 * `localeAlternates`.
 */
export function articleEntries(rows: readonly SitemapArticle[]): MetadataRoute.Sitemap {
  return rows.flatMap((a) => {
    const paths: Record<Locale, string> = {
      es: articlePath(a.id, a.titleEs ?? a.originalTitle),
      en: articlePath(a.id, a.titleEn ?? a.originalTitle),
    };
    const languages: Record<string, string> = {};
    for (const locale of routing.locales) languages[locale] = localizedUrl(locale, paths[locale]);
    languages["x-default"] = localizedUrl(routing.defaultLocale, paths[routing.defaultLocale]);
    return routing.locales.map((locale) => ({
      url: localizedUrl(locale, paths[locale]),
      lastModified: a.publishedAt,
      changeFrequency: "yearly" as const,
      priority: 0.5,
      alternates: { languages },
    }));
  });
}
