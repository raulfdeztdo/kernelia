const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_name",
  "utm_brand",
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "ref_url",
  "referrer",
  "source",
  "campaign_id",
  "ocid",
]);

/**
 * Canonicalize a URL for deduplication:
 * - lowercases host
 * - strips known tracking params
 * - removes fragment
 * - removes trailing slash on path (unless path is "/")
 * Returns the original input if URL parsing fails.
 */
export function canonicalizeUrl(input: string): string {
  try {
    const url = new URL(input.trim());
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }

    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    // Stable param order so the same URL with reordered params hashes equal.
    const sorted = new URLSearchParams([...url.searchParams.entries()].toSorted());
    url.search = sorted.toString() ? `?${sorted.toString()}` : "";

    return url.toString();
  } catch {
    return input.trim();
  }
}

/**
 * Strip HTML tags and collapse whitespace. Truncates to `max` chars.
 */
export function plainTextExcerpt(html: string | undefined | null, max = 500): string {
  if (!html) return "";
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > max ? `${stripped.slice(0, max - 1)}…` : stripped;
}

/**
 * Extract the URL of the first <img> tag in the given HTML, if any.
 * Returns null when no image is found or the input is empty.
 */
export function extractFirstImage(html: string | undefined | null): string | null {
  if (!html) return null;
  const match = html.match(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i);
  if (!match) return null;
  const src = match[1]?.trim();
  if (!src) return null;
  // Basic sanity check
  if (!/^https?:\/\//i.test(src)) return null;
  return src;
}

/**
 * Parse various date string formats. Returns null when input is unusable.
 */
export function parseDate(input: string | undefined | null): Date | null {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}
