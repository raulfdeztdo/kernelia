import { ImageResponse } from "next/og";

/**
 * The per-article social card (Phase 9.B): title, category accent, source
 * and kernelia.dev. Rendered by `app/api/og/...` and, since phase 9.D, by
 * the Hepha worker (`scripts/worker.ts og-cards`), which uploads it to
 * Supabase Storage so Vercel doesn't spend ~0.6 s of CPU per card.
 *
 * Takes plain strings so it runs outside Next.js too: callers resolve the
 * translations (`getTranslations` in the route, `createTranslator` in the
 * worker).
 *
 * Uses `next/og`'s bundled font (Noto Sans, regular) on purpose — no font
 * files to vendor. Hierarchy comes from size and colour, not weight.
 */

export interface ArticleCardInput {
  title: string;
  /** A known category slug, or null for the brand accent. */
  categorySlug: string | null;
  /** Translated category label shown in the pill, or null for none. */
  categoryLabel: string | null;
  /** Translated "via <source>" line. */
  via: string;
}

export const OG_CARD_SIZE = { width: 1200, height: 630 };

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

export function renderArticleCard(
  input: ArticleCardInput,
  init: { headers?: Record<string, string> } = {},
): ImageResponse {
  const accent = (input.categorySlug && CATEGORY_HEX[input.categorySlug]) || BRAND;
  const category = input.categoryLabel;
  const via = input.via;
  const { text, fontSize } = fitTitle(input.title);

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
    { ...OG_CARD_SIZE, ...init },
  );
}
