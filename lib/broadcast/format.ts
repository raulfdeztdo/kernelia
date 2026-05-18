import type { BroadcastPlatform } from "@/db/schema";

/**
 * Builds the text body for a broadcast post, one variant per platform.
 *
 * Constraints per platform (`MAX_CHARS_*`) come from the platform's API
 * docs:
 *   - Mastodon (fosstodon.org default): 500
 *   - Bluesky: 300 (grapheme-counted but we use length conservatively)
 *   - Telegram: 4096 — effectively unlimited for our content
 *
 * Truncation rule: cut the summary, never the title or URL. The URL must
 * always survive verbatim because it's the actual value of the post.
 * Titles are short enough by construction (LLM caps `title_es` to ~120
 * chars in `lib/ai/prompts/*`); if a title alone overflows we fall back
 * to "<title>... <url>" with the title elided as a last resort.
 */

export const MAX_CHARS_MASTODON = 500;
export const MAX_CHARS_BLUESKY = 300;
export const MAX_CHARS_TELEGRAM = 4096;

export interface BroadcastArticle {
  titleEs: string;
  summaryEs: string | null;
  url: string;
  categorySlug: string | null;
}

export function formatPost(article: BroadcastArticle, platform: BroadcastPlatform): string {
  switch (platform) {
    case "mastodon":
      return formatMastodon(article);
    case "bluesky":
      return formatBluesky(article);
    case "telegram":
      return formatTelegram(article);
  }
}

/**
 * Mastodon: 500 char limit. Title + summary + URL + hashtag.
 * We DO include the hashtag because Mastodon's discovery is hashtag-driven
 * — toots without tags barely surface in the "Explore" tab.
 */
function formatMastodon(article: BroadcastArticle): string {
  const tag = hashtagFor(article.categorySlug);
  const fixed = [article.titleEs, "", article.url, tag].filter(Boolean).join("\n");
  const room = MAX_CHARS_MASTODON - fixed.length - 2; // 2 = trailing "\n\n" before summary
  if (room <= 20 || !article.summaryEs) {
    // Not enough room for a meaningful summary; ship the fixed parts.
    return fixed;
  }
  const summary = truncateOnWordBoundary(article.summaryEs, room);
  return `${article.titleEs}\n\n${summary}\n\n${article.url}${tag ? `\n${tag}` : ""}`;
}

/**
 * Bluesky: 300 char limit, tight. We skip the summary entirely most days
 * and rely on the link card preview that Bluesky generates server-side
 * from OG meta tags. Format: "<title> — <url>".
 */
function formatBluesky(article: BroadcastArticle): string {
  const sep = " — ";
  const overhead = sep.length + article.url.length;
  const titleRoom = MAX_CHARS_BLUESKY - overhead;
  if (titleRoom <= 30) {
    // Pathological: URL alone almost fills the budget. Send the URL only.
    return article.url;
  }
  const title = article.titleEs.length <= titleRoom
    ? article.titleEs
    : `${article.titleEs.slice(0, titleRoom - 1).trimEnd()}…`;
  return `${title}${sep}${article.url}`;
}

/**
 * Telegram: 4096 char limit (we never get close). Markdown-V2 with bold
 * title, summary, link, and hashtag. Markdown-V2 needs aggressive escaping
 * — see `escapeMarkdownV2` below; if you change it, test against
 * Telegram's reserved set: `_*[]()~\`>#+-=|{}.!`.
 */
function formatTelegram(article: BroadcastArticle): string {
  const tag = hashtagFor(article.categorySlug);
  const parts = [
    `*${escapeMarkdownV2(article.titleEs)}*`,
    article.summaryEs ? "" : null,
    article.summaryEs ? escapeMarkdownV2(article.summaryEs) : null,
    "",
    `[Leer artículo](${escapeMarkdownV2Url(article.url)})`,
    tag ? `\n${escapeMarkdownV2(tag)}` : null,
  ].filter((p) => p !== null);
  return parts.join("\n");
}

/**
 * Word-boundary-aware truncation. We slice to `limit - 1` to leave room
 * for the ellipsis, then walk back to the previous space so we don't
 * stop mid-word. If there's no space (rare for prose), we just hard-cut.
 */
export function truncateOnWordBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const room = limit - 1; // leave 1 char for "…"
  const slice = text.slice(0, room);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > room * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.trimEnd()}…`;
}

/**
 * `#category-slug` is invalid for most platforms (no dashes); we map to
 * `#categorySlug` camel-ish. Null category → no tag.
 */
function hashtagFor(slug: string | null): string {
  if (!slug) return "";
  const camel = slug
    .split("-")
    .map((s, i) => (i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)))
    .join("");
  return `#${camel}`;
}

/**
 * Escape Telegram MarkdownV2 reserved characters.
 * Reference: https://core.telegram.org/bots/api#markdownv2-style
 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Inside a `[label](url)` link, only `)` and `\` need escaping in the URL
 * part. Everything else can stay verbatim — escaping a `.` would break
 * the host.
 */
function escapeMarkdownV2Url(url: string): string {
  return url.replace(/([)\\])/g, "\\$1");
}
