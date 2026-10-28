/**
 * Crawlers shut out of the whole site. SEO-tool and scraper bots that
 * Kernelia gets nothing back from, picked from the Oct-2026 function
 * invocations by user agent: together they were most of the traffic that
 * exhausted the Vercel Hobby quota (people are a few page views a day).
 * Search engines (Googlebot, Bingbot…) stay under the `*` group.
 *
 * AI crawlers are split by what they give back: the ones that only
 * collect training data are blocked; AI *search* agents (OAI-SearchBot,
 * ChatGPT-User, PerplexityBot, Claude-SearchBot) stay allowed because
 * they cite and link the page, so they can send readers.
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
  // AI training / scraping crawlers.
  "meta-externalagent",
  "AionBot",
  "Amazonbot",
  "ElevenlabsCrawler",
  "Barkrowler",
  "GPTBot",
  "CCBot",
  "ClaudeBot",
] as const;
