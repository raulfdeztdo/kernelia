type Locale = "es" | "en";

const RTF_CACHE = new Map<Locale, Intl.RelativeTimeFormat>();
function rtf(locale: Locale): Intl.RelativeTimeFormat {
  let cached = RTF_CACHE.get(locale);
  if (!cached) {
    cached = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    RTF_CACHE.set(locale, cached);
  }
  return cached;
}

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
      return rtf(locale).format(value, unit);
    }
  }
  return "";
}
