import { ImageResponse } from "next/og";
import { getTranslations } from "next-intl/server";
import { getPublicArticleByIdRange } from "@/db/queries/articles";
import { isLocale } from "@/i18n/routing";
import { isCategorySlug } from "@/lib/categories";
import { createLogger } from "@/lib/logger";
import { shortIdRange } from "@/lib/permalink";

/**
 * Per-article social card (Phase 9.B). This is what Telegram, Mastodon,
 * Bluesky, WhatsApp… show when someone shares a Kernelia permalink, so it
 * carries the brand: title, category accent, source and kernelia.dev.
 *
 * Uses `next/og`'s bundled font (Noto Sans, regular) on purpose — no font
 * files to vendor. Hierarchy comes from size and colour, not weight.
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

const SIZE = { width: 1200, height: 630 };
const SHORT_ID_RE = /^[0-9a-f]{12}$/;
const log = createLogger("og_image");

// Hex equivalents of the `--color-cat-*` oklch tokens in `app/globals.css`
// (Satori does not understand oklch). Keep in sync if the palette changes.
const CATEGORY_HEX: Record<string, string> = {
  llm: "#a883ff",
  agents: "#00c3f3",
  research: "#00d8b2",
  products: "#ff9c3b",
  robotics: "#ff6f69",
  policy: "#e5c226",
  safety: "#fb75bb",
  multimodal: "#00d4df",
  coding: "#61d46a",
  other: "#8c8f95",
};

const BG = "#0c0d10";
const FG = "#f7f7f7";
const MUTED = "#9ba1ab";
const BRAND = "#00d8b2";

function fitTitle(title: string): { text: string; fontSize: number } {
  const text = title.length > 150 ? `${title.slice(0, 147).trimEnd()}…` : title;
  const fontSize = text.length > 110 ? 52 : text.length > 70 ? 60 : 68;
  return { text, fontSize };
}

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

  const [tCategories, tArticle, tHome] = await Promise.all([
    getTranslations({ locale, namespace: "categories" }),
    getTranslations({ locale, namespace: "article" }),
    getTranslations({ locale, namespace: "home" }),
  ]);
  const categorySlug =
    article?.categorySlug && isCategorySlug(article.categorySlug) ? article.categorySlug : null;
  const accent = (categorySlug && CATEGORY_HEX[categorySlug]) || BRAND;
  const category = categorySlug ? tCategories(categorySlug) : null;
  const { text, fontSize } = fitTitle(article?.title ?? tHome("heading"));
  const via = article ? tArticle("via", { source: article.sourceName }) : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: BG,
          color: FG,
          position: "relative",
        }}
      >
        {/* Accent glow + edge bar in the category colour. */}
        <div
          style={{
            position: "absolute",
            top: -220,
            left: -160,
            width: 720,
            height: 720,
            borderRadius: 720,
            background: accent,
            opacity: 0.16,
            filter: "blur(120px)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: 14,
            background: accent,
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: "64px 80px 60px 94px",
            width: "100%",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 18, fontSize: 30 }}>
            {/* Same mark as `app/icon.svg` and the header LogoMark. */}
            <svg width="46" height="47" viewBox="0 0 460 470">
              <g fill={BRAND}>
                <polygon points="377,74 316,74 167,240 167,178 125,178 125,351" />
                <polygon points="210,291 311,390 372,390 240,259" />
              </g>
            </svg>
            <div style={{ display: "flex", color: FG }}>Kernelia</div>
            {category && (
              <div
                style={{
                  display: "flex",
                  marginLeft: 12,
                  padding: "6px 18px",
                  borderRadius: 999,
                  border: `2px solid ${accent}`,
                  color: accent,
                  fontSize: 22,
                  letterSpacing: 2,
                  textTransform: "uppercase",
                }}
              >
                {category}
              </div>
            )}
          </div>

          <div style={{ display: "flex", fontSize, lineHeight: 1.15, letterSpacing: -1 }}>
            {text}
          </div>

          <div
            style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: MUTED }}
          >
            <div style={{ display: "flex" }}>{via}</div>
            <div style={{ display: "flex", color: BRAND }}>kernelia.dev</div>
          </div>
        </div>
      </div>
    ),
    {
      ...SIZE,
      headers: {
        // Social scrapers re-fetch aggressively; let Vercel's CDN absorb it.
        // A missing article gets a short TTL so a late classification
        // shows up the same day.
        "Cache-Control": article
          ? "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400"
          : "public, max-age=300, s-maxage=3600",
      },
    },
  );
}
