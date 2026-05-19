import type { Locale } from "@/db/schema";

/**
 * Shared HTML shell for every transactional email Kernelia sends
 * (password reset, newsletter confirm, weekly digest). Living here:
 *
 *   - `escapeHtml`: belt-and-braces against arbitrary feed content
 *     reaching the rendered body.
 *   - `BRAND`: the dark-mode palette mirroring the site (oklch values
 *     converted to hex because email clients don't grok oklch).
 *   - `emailShell`: wraps the per-template body with brand header and
 *     footer. Tables-based layout for Gmail/Outlook compatibility,
 *     inline styles only (most clients strip `<style>` tags).
 *
 * Logo: an `<img>` to `logo-kernelia.svg` served from the public origin.
 * Outlook desktop ignores SVG (renders alt text); every other major
 * client (Gmail web/mobile, Apple Mail, iOS Mail, Yahoo) renders it
 * crisply at any DPR. Worth the Outlook trade-off because the SVG has
 * a transparent background and looks right on the dark canvas.
 */

export function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Hex approximations of the site's oklch palette (`app/globals.css`).
 * Email clients don't parse oklch, so we lock the colours to hex once
 * here and reuse them by reference everywhere else.
 */
export const BRAND = {
  bg: "#1a1d24", // --color-background
  surface: "#252830", // --color-surface
  surface2: "#2e323b", // --color-surface-2
  border: "#3a3e47", // --color-border
  borderStrong: "#52576a", // --color-border-strong
  foreground: "#fafafa", // --color-foreground
  muted: "#a3a8b5", // --color-muted-foreground
  mutedFaint: "#7a8090",
  accent: "#2dd4bf", // --color-accent (teal)
  accentDark: "#0d9488",
} as const;

interface EmailShellParams {
  /** Subject line, also rendered as <title>. */
  subject: string;
  /** Locale for the <html lang>. */
  locale: Locale;
  /** Origin (e.g. `https://kernelia.dev`) for the absolute logo URL. */
  siteUrl: string;
  /** Hand-rendered HTML for the main content area. */
  content: string;
  /**
   * Optional plaintext shown above the body in client previews
   * (Gmail/Apple Mail). Keep under 90 chars; doubles as the SMS-style
   * teaser before the email is opened.
   */
  preheader?: string;
  /** Optional unsubscribe URL appended to the footer when present. */
  unsubscribeUrl?: string;
  /** Optional translated unsubscribe label (defaults to ES). */
  unsubscribeLabel?: string;
  /**
   * Phase 8.H: optional URL to the per-subscriber preferences page. When
   * set, the footer renders a "Change preferences" link next to
   * Unsubscribe so a recipient can re-tune their category selection
   * without having to unsubscribe-and-resubscribe.
   */
  preferencesUrl?: string;
  /** Optional translated preferences label (defaults to locale). */
  preferencesLabel?: string;
  /** Translated tagline shown under the logo. */
  tagline?: string;
  /**
   * Phase 8.E open tracking. When set, the shell appends a 1x1
   * transparent pixel at the END of the body — anchored as far down
   * as possible so the open is only counted when the reader actually
   * scrolls through the content (best-effort: many clients
   * pre-render everything). It also adds a one-line privacy notice
   * to the footer telling the recipient that opens are measured.
   *
   * URL must be ABSOLUTE (e.g. `${siteUrl}/api/track/open?id=<sendId>`)
   * because the email runs in the recipient's mail client, not on
   * kernelia.dev.
   */
  trackingPixelUrl?: string;
}

/**
 * Returns a full `<!doctype html>` document. The caller supplies the
 * body for the "main" slot via `content`; the shell handles the
 * branded header, the preheader trick, the footer with the
 * unsubscribe link, and the surrounding dark canvas.
 */
export function emailShell(params: EmailShellParams): string {
  const {
    subject,
    locale,
    siteUrl,
    content,
    preheader,
    unsubscribeUrl,
    unsubscribeLabel,
    preferencesUrl,
    preferencesLabel,
    tagline,
    trackingPixelUrl,
  } = params;

  const origin = siteUrl.replace(/\/$/, "");
  const logoUrl = `${origin}/logo-kernelia.svg`;
  const taglineText = tagline ?? (locale === "en" ? "AI signal, no noise" : "Señal IA, sin ruido");
  const unsubLabel = unsubscribeLabel ?? (locale === "en" ? "Unsubscribe" : "Darse de baja");
  const prefsLabel =
    preferencesLabel ?? (locale === "en" ? "Change preferences" : "Cambiar preferencias");

  // Preheader: hidden inline text that email clients use for the
  // preview snippet. The followup `&zwnj;` + spaces stop Gmail from
  // pulling additional copy out of the body.
  const preheaderHtml = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BRAND.bg};opacity:0">${escapeHtml(preheader)}${"​ ".repeat(80)}</div>`
    : "";

  const footerUnsub = unsubscribeUrl
    ? ` · <a href="${escapeHtml(unsubscribeUrl)}" style="color:${BRAND.muted};text-decoration:underline">${escapeHtml(unsubLabel)}</a>`
    : "";
  // Preferences link sits BEFORE unsubscribe so the user sees the
  // softer option first — most people who want to "stop receiving X"
  // actually want to narrow the digest, not opt out entirely.
  const footerPrefs = preferencesUrl
    ? ` · <a href="${escapeHtml(preferencesUrl)}" style="color:${BRAND.muted};text-decoration:underline">${escapeHtml(prefsLabel)}</a>`
    : "";

  const trackingNotice = trackingPixelUrl
    ? `<div style="margin-top:8px;font-size:11px;color:${BRAND.mutedFaint};line-height:1.5;">${
        locale === "en"
          ? "This email contains a tiny tracking pixel that lets us measure opens. You can review our privacy notice on the site."
          : "Este correo incluye un pixel de seguimiento para medir aperturas. Puedes consultar el aviso de privacidad en la web."
      }</div>`
    : "";
  // Place the pixel as the very last visual element. Most clients
  // render it on first display so the open is timestamped close to
  // the actual reading moment. Width/height are zero pixels visible
  // (1x1 transparent PNG) and alt is empty to avoid screen-reader
  // noise.
  const trackingPixelHtml = trackingPixelUrl
    ? `<tr><td align="center" style="padding:0;line-height:0;font-size:0;">
        <img src="${escapeHtml(trackingPixelUrl)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;outline:none;opacity:0.01;">
      </td></tr>`
    : "";

  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<meta name="supported-color-schemes" content="dark light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${BRAND.bg};color:${BRAND.foreground};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
${preheaderHtml}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.bg}" style="background-color:${BRAND.bg};">
<tr><td align="center" style="padding:32px 16px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
    <!-- Header -->
    <tr><td align="center" style="padding:8px 0 32px;">
      <a href="${escapeHtml(origin)}" style="text-decoration:none;color:${BRAND.foreground};display:inline-block;">
        <img src="${escapeHtml(logoUrl)}" alt="Kernelia" width="56" height="56" style="display:block;margin:0 auto 12px;border:0;outline:none;">
        <div style="font-size:22px;font-weight:700;letter-spacing:-0.02em;color:${BRAND.foreground};">Kernelia</div>
        <div style="font-size:12px;color:${BRAND.muted};margin-top:4px;letter-spacing:0.02em;">${escapeHtml(taglineText)}</div>
      </a>
    </td></tr>
    <!-- Content -->
    <tr><td style="background-color:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:14px;padding:32px 28px;">
${content}
    </td></tr>
    <!-- Footer -->
    <tr><td align="center" style="padding:24px 16px 8px;font-size:12px;color:${BRAND.muted};line-height:1.6;">
      <a href="${escapeHtml(origin)}" style="color:${BRAND.accent};text-decoration:none;">kernelia.dev</a>${footerPrefs}${footerUnsub}
      ${trackingNotice}
    </td></tr>
    <tr><td align="center" style="padding:0 16px 16px;font-size:11px;color:${BRAND.mutedFaint};">
      © ${new Date().getFullYear()} Kernelia
    </td></tr>
    ${trackingPixelHtml}
  </table>
</td></tr>
</table>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Category labels for the digest chip. Kept in lockstep with
// `db/seed-data.ts` → `seedCategories`. If a slug is added to the
// catalog, add it here too — the chip falls back to the slug itself
// otherwise, which is ugly but not broken.
// ---------------------------------------------------------------------------

const CATEGORY_LABEL_ES: Record<string, string> = {
  llm: "Modelos de lenguaje",
  agents: "Agentes",
  research: "Investigación",
  products: "Productos",
  robotics: "Robótica",
  policy: "Regulación y política",
  safety: "Seguridad y alineamiento",
  multimodal: "Multimodal",
  coding: "IA para programar",
  other: "Otros",
};

const CATEGORY_LABEL_EN: Record<string, string> = {
  llm: "Language models",
  agents: "Agents",
  research: "Research",
  products: "Products",
  robotics: "Robotics",
  policy: "Policy & regulation",
  safety: "Safety & alignment",
  multimodal: "Multimodal",
  coding: "Coding AI",
  other: "Other",
};

export function categoryLabel(slug: string | null, locale: Locale): string | null {
  if (!slug) return null;
  const map = locale === "en" ? CATEGORY_LABEL_EN : CATEGORY_LABEL_ES;
  return map[slug] ?? slug;
}

/**
 * Renders the brand-accent CTA button used by the confirm and
 * password-reset templates. `bulletproof-style` table wrapper for
 * Outlook, with the visual fallback for everything else.
 */
export function ctaButton(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;">
<tr><td bgcolor="${BRAND.accent}" style="background-color:${BRAND.accent};border-radius:8px;">
  <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 28px;font-weight:600;font-size:15px;color:${BRAND.bg};text-decoration:none;border-radius:8px;letter-spacing:0.01em;">${escapeHtml(label)}</a>
</td></tr></table>`;
}
