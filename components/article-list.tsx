"use client";

// Three React Review rules fire spuriously in this file and are disabled
// at the top so the rest reads cleanly:
//   - `nextjs-no-use-search-params-without-suspense`: the parent route
//     `app/[locale]/page.tsx` already wraps this component in <Suspense>.
//   - `react-compiler-destructure-method`: `URLSearchParams.get` needs
//     its `this` binding; destructuring would crash at runtime.
//   - `no-derived-useState` for `initialItems` / `initialCursor`: the
//     parent re-keys the component on filter changes (`key={listKey}`),
//     so the state is seeded once per mount on purpose, not derived.
/* eslint-disable react-review/nextjs-no-use-search-params-without-suspense, react-review/react-compiler-destructure-method, react-review/no-derived-useState */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { NewsCard, type ArticleCardView } from "@/components/news-card";
import {
  FEED_REFRESH_INTERVAL_MS,
  FEED_REFRESH_LIMIT,
  mergeFreshArticles,
} from "@/lib/feed-refresh";

interface ArticleListProps {
  /** Server-rendered first batch. Drives the SSR HTML and SEO. */
  initialItems: ArticleCardView[];
  /** Encoded cursor for the page after `initialItems`, or null if exhausted. */
  initialCursor: string | null;
  locale: "es" | "en";
  /** Size of each "Load more" chunk. */
  pageSize: number;
  /**
   * Total matching articles for the current filters (under the per-source
   * cap). Stays constant while the user pages through with "Cargar más" —
   * the header should read "N noticias" where N is the whole pool, not the
   * subset rendered so far.
   */
  total: number;
}

interface ApiResponse {
  items: ArticleCardView[];
  nextCursor: string | null;
}

/**
 * Client-side incremental list. Initial items come from the server so the
 * first paint and SEO crawl see real cards. "Load more" appends additional
 * pages without navigating, preserving scroll and previously loaded cards.
 *
 * We deliberately do NOT auto-load on scroll: users opt in by clicking the
 * button. Auto-load on a category-dense feed makes the footer impossible
 * to reach and is harder for keyboard users.
 *
 * When filters change (q / category), the surrounding URL changes too — the
 * server page re-runs and remounts this component with a fresh `initialItems`
 * via the `resetKey`-style behaviour of React (different key from parent).
 *
 * Auto-refresh (Phase 9.B): while the tab is visible, every 5 minutes the
 * list asks for the newest articles (same filters) and merges in the ones
 * it doesn't have. It never reloads the page — the reader keeps their
 * scroll position, their "load more" pages and their search. When cards
 * land above the viewport, the scroll is compensated so what the reader is
 * looking at doesn't jump, and a pill offers to go up and see them.
 */
export function ArticleList({
  initialItems,
  initialCursor,
  locale,
  pageSize,
  total,
}: ArticleListProps) {
  const t = useTranslations("home");
  // Not destructuring `get` even though the lint suggests it: URLSearchParams
  // methods need their `this` binding.
  const searchParams = useSearchParams();
  // `initialItems` / `initialCursor` seed the state on mount only. The parent
  // (app/[locale]/page.tsx) re-keys this component (`key={listKey}`) when the
  // user changes locale / search / category, which remounts and re-seeds.
  // No reset-on-prop-change useEffect needed — the key handles it cleanly,
  // without the cascading set-states React Review flagged.
  const [items, setItems] = useState<ArticleCardView[]>(initialItems);
  const [cursor, setCursor] = useState<string | null>(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track in-flight requests so a stale response cannot overwrite newer state
  // if the user clicks twice or filters change mid-fetch.
  const requestIdRef = useRef(0);
  // Auto-refresh state. `itemsRef` lets the timer read the latest list
  // without re-subscribing on every change.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [addedTotal, setAddedTotal] = useState(0);
  const [pendingAbove, setPendingAbove] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<{ id: string; top: number } | null>(null);

  // Manual scroll anchoring: after new cards are committed, put the card
  // the reader was looking at back where it was. Done by hand (and the
  // browser's own `overflow-anchor` disabled on the grid) because Safari
  // doesn't implement scroll anchoring.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-article-id="${anchor.id}"]`);
    if (!el) return;
    const delta = el.getBoundingClientRect().top - anchor.top;
    if (delta !== 0) window.scrollBy({ top: delta, behavior: "instant" });
  }, [items]);

  // Hide the pill once the reader is back at the top on their own.
  useEffect(() => {
    if (pendingAbove === 0) return;
    function onScroll() {
      if (window.scrollY < 200) setPendingAbove(0);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [pendingAbove]);

  useEffect(() => {
    let lastCheck = Date.now();
    let inFlight = false;

    async function refresh() {
      if (inFlight) return;
      inFlight = true;
      lastCheck = Date.now();
      try {
        const sp = new URLSearchParams();
        sp.set("locale", locale);
        sp.set("limit", String(FEED_REFRESH_LIMIT));
        const q = searchParams.get("q");
        if (q) sp.set("q", q);
        const cat = searchParams.get("category");
        if (cat) sp.set("category", cat);
        const res = await fetch(`/api/articles?${sp.toString()}`, {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as ApiResponse;
        const { items: merged, added } = mergeFreshArticles(itemsRef.current, data.items);
        if (added.length === 0) return;

        // Which of the new cards will land above what the reader sees?
        // Anchor on the first card still visible in the viewport.
        const cards = gridRef.current?.querySelectorAll<HTMLElement>("[data-article-id]") ?? [];
        let anchor: { id: string; top: number } | null = null;
        for (const card of cards) {
          const rect = card.getBoundingClientRect();
          if (rect.bottom > 0) {
            anchor = { id: card.dataset.articleId ?? "", top: rect.top };
            break;
          }
        }
        const scrolled = window.scrollY > 200;
        if (anchor && scrolled) {
          anchorRef.current = anchor;
          const anchorIndex = merged.findIndex((a) => a.id === anchor.id);
          const addedIds = new Set(added.map((a) => a.id));
          const above = merged.slice(0, anchorIndex).filter((a) => addedIds.has(a.id)).length;
          if (above > 0) setPendingAbove((n) => n + above);
        }
        setItems(merged);
        setAddedTotal((n) => n + added.length);
      } catch {
        // Silent: the next tick retries. A failed background check must
        // never surface an error to someone who is just reading.
      } finally {
        inFlight = false;
      }
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, FEED_REFRESH_INTERVAL_MS);
    // A tab left in the background doesn't poll; when the reader comes
    // back after the interval has elapsed, check right away.
    function onVisibility() {
      if (document.visibilityState === "visible" && Date.now() - lastCheck >= FEED_REFRESH_INTERVAL_MS) {
        void refresh();
      }
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [locale, searchParams]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    const myReq = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams();
      sp.set("locale", locale);
      sp.set("cursor", cursor);
      sp.set("limit", String(pageSize));
      const q = searchParams.get("q");
      if (q) sp.set("q", q);
      const cat = searchParams.get("category");
      if (cat) sp.set("category", cat);

      const res = await fetch(`/api/articles?${sp.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Stale-response guard runs twice on purpose: once before parsing
      // (cheap skip if a newer request already started while we were
      // awaiting the fetch) and once after (covers the race where the
      // new request kicked off during `await res.json()`). The lint
      // `async-defer-await` only sees the second one and flags it; the
      // first is the cheap skip the rule actually wants.
      if (myReq !== requestIdRef.current) return;
      // eslint-disable-next-line react-review/async-defer-await
      const data = (await res.json()) as ApiResponse;

      if (myReq !== requestIdRef.current) return;

      setItems((prev) => {
        // Dedupe by id in case the cursor boundary article appears twice
        // (e.g. clock skew between paginated DB reads). Cheap to do — keeps
        // the public feed correct even under rare race conditions.
        const seen = new Set(prev.map((a) => a.id));
        const fresh = data.items.filter((a) => !seen.has(a.id));
        return [...prev, ...fresh];
      });
      setCursor(data.nextCursor);
    } catch {
      if (myReq !== requestIdRef.current) return;
      setError(t("loadMoreError"));
    } finally {
      if (myReq === requestIdRef.current) setLoading(false);
    }
  }, [cursor, loading, locale, pageSize, searchParams, t]);

  if (items.length === 0) {
    // The server page already handles the empty/error states above this
    // component, so an empty state here would only show if the server
    // returned items and the client somehow cleared them — unlikely, but
    // we render nothing rather than break layout.
    return null;
  }

  return (
    <>
      <p className="text-sm text-[color:var(--color-muted-foreground)]">
        {t("resultsCount", { count: total + addedTotal })}
      </p>

      {pendingAbove > 0 && (
        <div className="pointer-events-none fixed inset-x-0 top-20 z-20 flex justify-center">
          <button
            type="button"
            onClick={() => {
              setPendingAbove(0);
              gridRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-[color:var(--color-background)] shadow-lg transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/50"
          >
            <span aria-hidden>↑</span>
            {t("newArticles", { count: pendingAbove })}
          </button>
        </div>
      )}
      {/* Announces background additions to screen readers, pill or not. */}
      <p aria-live="polite" className="sr-only">
        {addedTotal > 0 ? t("newArticles", { count: addedTotal }) : ""}
      </p>

      <div
        ref={gridRef}
        // Scroll anchoring is done by hand above; the browser's own would
        // compensate a second time in Chrome/Firefox.
        style={{ overflowAnchor: "none" }}
        className="grid scroll-mt-24 grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3"
      >
        {items.map((article) => (
          <NewsCard key={article.id} article={article} locale={locale} />
        ))}
      </div>

      {cursor && (
        <div className="flex flex-col items-center gap-2 pt-4">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            aria-busy={loading}
            className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-6 py-2.5 text-sm font-medium transition hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-2)] disabled:cursor-progress disabled:opacity-70"
          >
            {loading ? t("loadingMore") : t("loadMore")}
          </button>
          {error && (
            <p
              role="alert"
              className="text-xs text-[color:var(--color-muted-foreground)]"
            >
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
