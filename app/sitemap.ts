import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";
import { localeAlternates, localizedUrl } from "@/lib/site";

/** Public, static-ish routes per locale. */
const STATIC_PATHS = ["/", "/about"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

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
