/**
 * Centralized site config used by metadata, sitemap, robots and RSS.
 *
 * Resolution order for the public origin:
 *   1. NEXT_PUBLIC_SITE_URL (preferred, set in Vercel)
 *   2. VERCEL_URL (added automatically on Vercel, no protocol)
 *   3. http://localhost:3000 (dev fallback)
 */

import { routing, type Locale } from "@/i18n/routing";

export const SITE_NAME = "Kernelia";
export const SITE_HANDLE = "@kernelia";

export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL;
  if (fromEnv && fromEnv.length > 0) {
    return stripTrailingSlash(fromEnv);
  }
  const vercel = process.env.VERCEL_URL;
  if (vercel && vercel.length > 0) {
    return `https://${stripTrailingSlash(vercel)}`;
  }
  return "http://localhost:3000";
}

function stripTrailingSlash(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

/**
 * Build an absolute URL for a given locale + path.
 * With `localePrefix: "as-needed"` the default locale (es) has no prefix.
 */
export function localizedUrl(locale: Locale, path: string = "/"): string {
  const origin = getSiteUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  if (locale === routing.defaultLocale) {
    return normalized === "/" ? origin : `${origin}${normalized}`;
  }
  const suffix = normalized === "/" ? "" : normalized;
  return `${origin}/${locale}${suffix}`;
}

/**
 * Build the alternates.languages map for a path. Uses every configured locale
 * plus an `x-default` pointing at the default locale.
 */
export function localeAlternates(path: string = "/"): Record<string, string> {
  const langs: Record<string, string> = {};
  for (const locale of routing.locales) {
    langs[locale] = localizedUrl(locale, path);
  }
  langs["x-default"] = localizedUrl(routing.defaultLocale, path);
  return langs;
}
