"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * First-party analytics beacon (Phase 9.A). Renders nothing.
 *
 * - One `pageview` per pathname change. Query-string changes (search,
 *   category filters) are deliberately NOT new pageviews.
 * - One `cta` per click on an element marked `data-track="cta:<id>"`.
 * - One `outbound` per click on a link to another host; the nearest
 *   `data-article-id` ancestor ties the click to an article.
 *
 * Everything goes through `navigator.sendBeacon`, which survives the
 * page unloading on an outbound click and never blocks navigation.
 * No cookies, no storage, no identifiers: see `lib/analytics/event.ts`.
 *
 * Only the production build reports, so `pnpm dev` against the
 * production database can't pollute the numbers.
 */

const ENDPOINT = "/api/pulse";

type Payload = {
  e: "pageview" | "outbound" | "cta";
  p: string;
  r?: string;
  a?: string;
  t?: string;
  us?: string;
  um?: string;
  uc?: string;
};

function send(payload: Payload): void {
  try {
    const body = JSON.stringify(payload);
    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(ENDPOINT, body);
      return;
    }
    void fetch(ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    // Analytics must never break the page.
  }
}

function withoutEmpty(payload: Payload): Payload {
  return Object.fromEntries(
    Object.entries(payload).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  ) as Payload;
}

function pageArticleId(): string | undefined {
  const el = document.querySelector<HTMLElement>("[data-article-page]");
  return el?.dataset.articleId || undefined;
}

export function AnalyticsBeacon(): null {
  const pathname = usePathname();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    const params = new URLSearchParams(window.location.search);
    send(
      withoutEmpty({
        e: "pageview",
        p: pathname,
        r: document.referrer,
        a: pageArticleId(),
        us: params.get("utm_source") ?? undefined,
        um: params.get("utm_medium") ?? undefined,
        uc: params.get("utm_campaign") ?? undefined,
      }),
    );
  }, [pathname]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    function onClick(event: MouseEvent): void {
      // Left and middle clicks are both "the reader opened this".
      if (event.button !== 0 && event.button !== 1) return;
      const origin = event.target instanceof Element ? event.target : null;
      if (!origin) return;

      const tracked = origin.closest<HTMLElement>("[data-track]");
      const cta = tracked?.dataset.track?.startsWith("cta:")
        ? tracked.dataset.track.slice(4)
        : null;
      if (cta) {
        send(withoutEmpty({ e: "cta", p: window.location.pathname, t: cta }));
        return;
      }

      const link = origin.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;
      let url: URL;
      try {
        url = new URL(link.href, window.location.href);
      } catch {
        return;
      }
      if (!/^https?:$/.test(url.protocol) || url.host === window.location.host) return;
      const articleId =
        link.closest<HTMLElement>("[data-article-id]")?.dataset.articleId ?? pageArticleId();
      send(
        withoutEmpty({
          e: "outbound",
          p: window.location.pathname,
          t: url.hostname.replace(/^www\./, ""),
          a: articleId,
        }),
      );
    }

    // `auxclick` covers middle-click, which does not fire `click`.
    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("auxclick", onClick, { capture: true });
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("auxclick", onClick, { capture: true });
    };
  }, []);

  return null;
}
