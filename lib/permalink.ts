import { routing, type Locale } from "@/i18n/routing";
import { getSiteUrl, localizedUrl } from "@/lib/site";

/**
 * Article permalinks (Phase 9.B): `/n/<slug>-<shortId>`, e.g.
 * `/n/openai-lanza-gpt-6-3f2b8c1e4a5d` (ES) and
 * `/en/n/openai-launches-gpt-6-3f2b8c1e4a5d` (EN).
 *
 * - `shortId` is the first 12 hex digits of the article UUID (48 bits).
 *   It resolves with a range scan on the primary key — no extra column,
 *   no migration, no backfill (see `shortIdRange`).
 * - The slug is cosmetic and per locale. The page 308-redirects any
 *   stale or hand-typed slug to the canonical one, so titles can be
 *   re-translated without breaking links that are already out there.
 */

export const SHORT_ID_LENGTH = 12;
const MAX_SLUG_LENGTH = 70;
const SHORT_ID_RE = /^[0-9a-f]{12}$/;

/** URL-safe, accent-free, lower-case slug. Never empty. */
export function slugify(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length === 0) return "n";
  if (base.length <= MAX_SLUG_LENGTH) return base;
  // Cut on a word boundary so the slug doesn't end mid-word.
  const cut = base.slice(0, MAX_SLUG_LENGTH);
  const lastDash = cut.lastIndexOf("-");
  return lastDash > MAX_SLUG_LENGTH / 2 ? cut.slice(0, lastDash) : cut;
}

export function shortIdOf(articleId: string): string {
  return articleId.replace(/-/g, "").slice(0, SHORT_ID_LENGTH).toLowerCase();
}

/** The `[slug]` route segment for an article: `<slug>-<shortId>`. */
export function articleSegment(articleId: string, title: string): string {
  return `${slugify(title)}-${shortIdOf(articleId)}`;
}

/** Locale-less path, as `next-intl`'s `Link`/`localizedUrl` expect it. */
export function articlePath(articleId: string, title: string): string {
  return `/n/${articleSegment(articleId, title)}`;
}

/** Path including the locale prefix (none for the default locale). */
export function articleHref(locale: Locale, articleId: string, title: string): string {
  const path = articlePath(articleId, title);
  return locale === routing.defaultLocale ? path : `/${locale}${path}`;
}

/** Absolute URL, e.g. for broadcasts, emails, canonical tags. */
export function articleUrl(locale: Locale, articleId: string, title: string): string {
  return localizedUrl(locale, articlePath(articleId, title));
}

/**
 * Absolute URL of the article's social card (`app/api/og/...`). Keyed on
 * the short id only, so it survives title changes.
 */
export function articleOgImageUrl(locale: Locale, articleId: string): string {
  return `${getSiteUrl()}/api/og/${locale}/${shortIdOf(articleId)}`;
}

/**
 * Appends UTM parameters so `/admin/analytics` can attribute visits to
 * the channel that sent them (our own broadcasts and emails).
 */
export function withUtm(
  url: string,
  utm: { source: string; medium: string; campaign?: string },
): string {
  const u = new URL(url);
  u.searchParams.set("utm_source", utm.source);
  u.searchParams.set("utm_medium", utm.medium);
  if (utm.campaign) u.searchParams.set("utm_campaign", utm.campaign);
  return u.toString();
}

export interface ParsedArticleSegment {
  slug: string;
  shortId: string;
}

/** Splits `<slug>-<shortId>`; `null` if the segment doesn't end in a short id. */
export function parseArticleSegment(segment: string): ParsedArticleSegment | null {
  const decoded = safeDecode(segment).toLowerCase();
  const dash = decoded.lastIndexOf("-");
  const shortId = dash === -1 ? decoded : decoded.slice(dash + 1);
  if (!SHORT_ID_RE.test(shortId)) return null;
  return { slug: dash === -1 ? "" : decoded.slice(0, dash), shortId };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Inclusive UUID bounds that contain every id starting with `shortId`.
 * Postgres orders `uuid` byte-wise, i.e. like the lower-case hex string,
 * so `id BETWEEN lo AND hi` is an index range scan on the primary key.
 */
export function shortIdRange(shortId: string): { lo: string; hi: string } {
  const a = shortId.slice(0, 8);
  const b = shortId.slice(8, 12);
  return {
    lo: `${a}-${b}-0000-0000-000000000000`,
    hi: `${a}-${b}-ffff-ffff-ffffffffffff`,
  };
}
