import type { ArticleCardView } from "@/components/news-card";

/**
 * Home auto-refresh (Phase 9.B): how often an open home page checks for
 * news, and how the answer is merged into what the reader already has.
 */

export const FEED_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
/** How many of the newest articles each check asks for (API max is 24). */
export const FEED_REFRESH_LIMIT = 24;

/** Same order as the server: `published_at DESC, id DESC`. */
function compareFeedOrder(a: ArticleCardView, b: ArticleCardView): number {
  if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

export interface MergeResult {
  items: ArticleCardView[];
  /** Articles that were not on screen before, in feed order. */
  added: ArticleCardView[];
}

/**
 * Merges a fresh first page into the list on screen.
 *
 * Only articles that fall inside the range already loaded (published at or
 * after the oldest card shown) are inserted, each in its chronological
 * slot. Anything older belongs to a page the reader hasn't loaded yet and
 * will arrive through "Cargar más" as usual, so inserting it here would
 * duplicate it later. Articles already on screen are never touched: no
 * card the reader is looking at moves or changes.
 */
export function mergeFreshArticles(
  current: readonly ArticleCardView[],
  incoming: readonly ArticleCardView[],
): MergeResult {
  if (current.length === 0) return { items: [...current], added: [] };
  const seen = new Set(current.map((a) => a.id));
  const oldest = current.reduce(
    (min, a) => (a.publishedAt < min ? a.publishedAt : min),
    current[0]?.publishedAt ?? "",
  );
  const added = incoming
    .filter((a) => !seen.has(a.id) && a.publishedAt >= oldest)
    .toSorted(compareFeedOrder);
  if (added.length === 0) return { items: [...current], added: [] };
  return { items: [...current, ...added].toSorted(compareFeedOrder), added };
}
