import { NextResponse } from "next/server";
import { listLatestForFeed } from "@/db/queries/articles";
import { isLocale, routing } from "@/i18n/routing";
import { buildRssFeed } from "@/lib/rss";
import { createLogger } from "@/lib/logger";
import { getSiteUrl, localizedUrl, SITE_NAME } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("rss");

const META: Record<"es" | "en", { title: string; description: string }> = {
  es: {
    title: `${SITE_NAME} — Noticias de IA`,
    description: "Últimas noticias sobre IA, clasificadas y resumidas.",
  },
  en: {
    title: `${SITE_NAME} — AI news`,
    description: "Latest AI news, classified and summarized.",
  },
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawLang = url.searchParams.get("lang") ?? routing.defaultLocale;
  const lang = isLocale(rawLang) ? rawLang : routing.defaultLocale;

  try {
    const items = await listLatestForFeed(lang, 50);
    const feed = buildRssFeed({
      title: META[lang].title,
      description: META[lang].description,
      siteUrl: localizedUrl(lang, "/"),
      selfUrl: `${getSiteUrl()}/rss.xml?lang=${lang}`,
      language: lang,
      items,
    });

    return new NextResponse(feed, {
      status: 200,
      headers: {
        "Content-Type": "application/rss+xml; charset=utf-8",
        // Cache 10 minutes on edge, allow stale-while-revalidate for 1h.
        "Cache-Control": "public, max-age=600, stale-while-revalidate=3600",
      },
    });
  } catch (err) {
    log.error("feed_failed", {
      lang,
      reason: err instanceof Error ? err.message : String(err),
    });
    return new NextResponse("feed unavailable", { status: 503 });
  }
}
