import { NextResponse } from "next/server";
import { isLocale } from "@/i18n/routing";
import {
  listClassifiedArticles,
  type ListedArticle,
} from "@/db/queries/articles";
import { parseCategoryParam } from "@/lib/categories";
import { createLogger } from "@/lib/logger";
import type { ArticleCardView } from "@/components/news-card";

/**
 * Public, read-only JSON endpoint that powers the client-side
 * "Load more" pagination. The home page still server-renders the first
 * batch directly from `listClassifiedArticles` (for SSR + SEO); this
 * route is only used for incremental appends.
 *
 * Pagination contract: callers pass the `nextCursor` returned by the
 * previous call. When `nextCursor` is null, the feed is exhausted.
 *
 * Hard caps:
 *  - `limit` is clamped to [1, 24]. The default `6` matches the
 *    chunk size the UI is designed around.
 *  - Same `PER_SOURCE_CAP` as the server page (enforced inside the
 *    query) — no need to filter again here.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const log = createLogger("api.articles");
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 24;

interface ApiResponse {
  items: ArticleCardView[];
  nextCursor: string | null;
}

function parseCursor(
  raw: string | null,
): { publishedAt: Date; id: string } | undefined {
  if (!raw) return undefined;
  const [ts, id] = raw.split("|");
  if (!ts || !id) return undefined;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return undefined;
  return { publishedAt: d, id };
}

function encodeCursor(article: ListedArticle): string {
  return `${article.publishedAt.toISOString()}|${article.id}`;
}

function toView(a: ListedArticle): ArticleCardView {
  return {
    id: a.id,
    title: a.title,
    url: a.url,
    summary: a.summary,
    imageUrl: a.imageUrl,
    publishedAt: a.publishedAt.toISOString(),
    sourceName: a.sourceName,
    categorySlug: a.categorySlug,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const locale = url.searchParams.get("locale");
  if (!isLocale(locale)) {
    return NextResponse.json({ error: "invalid_locale" }, { status: 400 });
  }

  const q = url.searchParams.get("q") ?? undefined;
  const categorySlugs = parseCategoryParam(
    url.searchParams.get("category") ?? undefined,
  );
  const cursor = parseCursor(url.searchParams.get("cursor"));

  const limitParam = Number.parseInt(
    url.searchParams.get("limit") ?? "",
    10,
  );
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(limitParam, MAX_LIMIT)
    : DEFAULT_LIMIT;

  try {
    // Fetch limit+1 so we can tell whether more pages exist without an
    // extra round trip.
    const rows = await listClassifiedArticles({
      locale,
      categorySlugs,
      q,
      limit: limit + 1,
      cursor,
    });

    const hasMore = rows.length > limit;
    const visible = hasMore ? rows.slice(0, limit) : rows;
    const last = visible[visible.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last) : null;

    const body: ApiResponse = {
      items: visible.map(toView),
      nextCursor,
    };
    return NextResponse.json(body, {
      headers: {
        // Don't let a CDN cache a paginated slice keyed by query params —
        // articles are written continuously by the cron.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    log.error("articles_query_failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }
}
