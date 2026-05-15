"use client";

import { useCallback, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { NewsCard, type ArticleCardView } from "@/components/news-card";

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
      const data = (await res.json()) as ApiResponse;

      // Drop the response if a newer request superseded it.
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
        {t("resultsCount", { count: total })}
      </p>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
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
