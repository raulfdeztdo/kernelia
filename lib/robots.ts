/**
 * Crawlers shut out of the whole site. SEO-tool and scraper bots that
 * Kernelia gets nothing back from, picked from the Oct-2026 function
 * invocations by user agent: together they were most of the traffic that
 * exhausted the Vercel Hobby quota (people are a few page views a day).
 * Search engines (Googlebot, Bingbot…) stay under the `*` group.
 *
 * Only well-behaved bots read this; the ones that ignore it are denied by
 * the Vercel Firewall rule documented in `context-docs/coding-principles.md`.
 */
export const BLOCKED_BOTS = [
  "AhrefsBot",
  "SemrushBot",
  "serpstatbot",
  "MJ12bot",
  "DotBot",
  "PetalBot",
  "Bytespider",
  "Reflectionbot",
  "KeenableBot",
  "LivelapBot",
  "ExaSearchBot",
] as const;
