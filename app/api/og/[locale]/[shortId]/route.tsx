import { getTranslations } from "next-intl/server";
import { getPublicArticleByIdRange } from "@/db/queries/articles";
import { isLocale } from "@/i18n/routing";
import { isCategorySlug } from "@/lib/categories";
import { createLogger } from "@/lib/logger";
import { renderArticleCard } from "@/lib/og/card";
import { defaultOgImageUrl, hasOwnOgCard, shortIdRange } from "@/lib/permalink";

/**
 * Per-article social card (Phase 9.B). This is what Telegram, Mastodon,
 * Bluesky, WhatsApp… show when someone shares a Kernelia permalink, so it
 * carries the brand: title, category accent, source and kernelia.dev.
 *
 * The card itself lives in `lib/og/card.tsx`. Since phase 9.D article pages
 * advertise the copy the Hepha worker pre-renders into Supabase Storage
 * (`lib/og/storage.ts`); this route stays for links that still point here
 * and as the fallback when that copy is missing.
 *
 * Why a route handler under `/api/og/<locale>/<shortId>` and not the
 * `opengraph-image.tsx` file convention: for the default locale Next
 * emits the convention's URL with the internal `/es` segment, which the
 * next-intl middleware then 307-redirects (and mangles the cache-busting
 * query on the way). Scrapers that don't follow redirects lose the image.
 * `/api/*` bypasses the middleware, so this URL is served directly, and
 * keying on the short id alone keeps it stable if a title is retranslated.
 */

export const runtime = "nodejs";

const SHORT_ID_RE = /^[0-9a-f]{12}$/;
const log = createLogger("og_image");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; shortId: string }> },
): Promise<Response> {
  const { locale: rawLocale, shortId: rawShortId } = await params;
  const locale = isLocale(rawLocale) ? rawLocale : "es";
  // Tolerate a trailing extension (`…/9fa234db12e2.png`) some clients add.
  const shortId = rawShortId.replace(/\.png$/i, "").toLowerCase();

  let article: Awaited<ReturnType<typeof getPublicArticleByIdRange>> = null;
  if (SHORT_ID_RE.test(shortId)) {
    try {
      article = await getPublicArticleByIdRange(shortIdRange(shortId), locale);
    } catch (err) {
      // Fall through to the generic brand card: a broken preview image
      // is worse than a generic one.
      log.warn("article_lookup_failed", {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Only fresh articles get a rendered card (see `OG_CARD_MAX_AGE_DAYS`).
  // Anything else — old articles still linked from cached pages, unknown
  // ids from crawlers — goes to the static brand card, which costs no
  // render. A missing article (or a transient DB error) gets a temporary
  // redirect with a short TTL, so a late classification gets its own
  // card the same day.
  if (!article || !hasOwnOgCard(article.publishedAt)) {
    return new Response(null, {
      status: article ? 308 : 307,
      headers: {
        Location: defaultOgImageUrl(locale),
        "Cache-Control": article
          ? "public, max-age=86400, s-maxage=2592000"
          : "public, max-age=300, s-maxage=3600",
      },
    });
  }

  const [tCategories, tArticle] = await Promise.all([
    getTranslations({ locale, namespace: "categories" }),
    getTranslations({ locale, namespace: "article" }),
  ]);
  const categorySlug =
    article.categorySlug && isCategorySlug(article.categorySlug) ? article.categorySlug : null;

  return renderArticleCard(
    {
      title: article.title,
      categorySlug,
      categoryLabel: categorySlug ? tCategories(categorySlug) : null,
      via: tArticle("via", { source: article.sourceName }),
    },
    {
      headers: {
        // Social scrapers re-fetch aggressively; let Vercel's CDN absorb it.
        "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
      },
    },
  );
}
