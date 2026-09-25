import type { MetadataRoute } from "next";
import { listArticlesForSitemap, type SitemapArticle } from "@/db/queries/articles";
import { routing } from "@/i18n/routing";
import { createLogger } from "@/lib/logger";
import { articleEntries } from "@/lib/sitemap";
import { localeAlternates, localizedUrl } from "@/lib/site";

/**
 * Regenerated at most once an hour: new articles land every 30 min and a
 * sitemap an hour stale costs nothing, while rebuilding it per crawler
 * hit would run a multi-thousand-row query each time.
 */
export const revalidate = 3600;

const log = createLogger("sitemap");

/** Public, static-ish routes per locale. */
const STATIC_PATHS = ["/", "/about"] as const;

function staticEntries(now: Date): MetadataRoute.Sitemap {
  return STATIC_PATHS.flatMap((path) => {
    const languages = localeAlternates(path);
    return routing.locales.map((locale) => ({
      url: localizedUrl(locale, path),
      lastModified: now,
      changeFrequency: path === "/" ? ("hourly" as const) : ("monthly" as const),
      priority: path === "/" ? 1 : 0.6,
      alternates: { languages },
    }));
  });
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  let articles: SitemapArticle[] = [];
  try {
    articles = await listArticlesForSitemap();
  } catch (err) {
    // No DB at build time (CI) or a transient outage: still serve the
    // static routes rather than a 500 that search engines would cache.
    log.warn("articles_query_failed", { reason: err instanceof Error ? err.message : String(err) });
  }
  return [...staticEntries(now), ...articleEntries(articles)];
}
