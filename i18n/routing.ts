import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["es", "en"],
  defaultLocale: "es",
  localePrefix: "as-needed",
  // `/` is always Spanish, `/en` is always English. We do NOT want the
  // middleware to redirect based on `Accept-Language`: that would desync
  // the canonical URLs declared in `lib/site.ts` (where `/` = es, `/en` = en)
  // from what a user/crawler actually sees, and would also serve the wrong
  // locale to Playwright (which sends `Accept-Language: en-US` in CI).
  localeDetection: false,
  localeCookie: {
    name: "NEXT_LOCALE",
    maxAge: 60 * 60 * 24 * 365,
  },
});

export type Locale = (typeof routing.locales)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (routing.locales as readonly string[]).includes(value);
}
