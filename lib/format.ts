type Locale = "es" | "en";

// Hoisted at module load: Intl.RelativeTimeFormat allocates internal
// data every time it constructs. With only two supported locales we
// can build both eagerly and avoid the lazy-cache + lookup on each
// call. `formatRelative` is called once per card (~18 cards per
// SSR render) so this is the hot path.
const RTF_BY_LOCALE: Record<Locale, Intl.RelativeTimeFormat> = {
  es: new Intl.RelativeTimeFormat("es", { numeric: "auto" }),
  en: new Intl.RelativeTimeFormat("en", { numeric: "auto" }),
};

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** Format a Date as a relative-to-now string in the given locale. */
export function formatRelative(input: Date | string, locale: Locale, now: Date = new Date()): string {
  const d = input instanceof Date ? input : new Date(input);
  const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  for (const [unit, secs] of UNITS) {
    if (abs >= secs || unit === "second") {
      const value = Math.round(diffSec / secs);
      return RTF_BY_LOCALE[locale].format(value, unit);
    }
  }
  return "";
}
