import { createLogger } from "@/lib/logger";
import { getSiteUrl } from "@/lib/site";
import type { DigestArticle } from "@/lib/newsletter/digest";
import type { Locale } from "@/db/schema";
import { BRAND, categoryLabel, ctaButton, emailShell, escapeHtml } from "./templates";

/**
 * Email helper. Wraps the Resend HTTP API directly (no SDK) so the
 * dependency surface stays at zero new packages. If we ever migrate
 * provider, this is the only file that changes.
 *
 * Required env vars (validated lazily at first call):
 *   - RESEND_API_KEY: API key from <https://resend.com/api-keys>
 *   - EMAIL_FROM:     verified sender ("Kernelia <admin@kernelia.dev>")
 *                     During domain-verification gap, use
 *                     "Kernelia <onboarding@resend.dev>" — emails will
 *                     only deliver to the Resend account's own inbox.
 *   - NEXT_PUBLIC_SITE_URL: origin for the `<img>` to the logo and the
 *                     "kernelia.dev" link in the footer.
 *
 * Every transactional email Kernelia sends now flows through the
 * shared shell in `templates.ts` — dark canvas + transparent SVG logo
 * + branded header/footer. Per-template bodies are kept small and
 * focused.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const log = createLogger("email");

interface ResendRequest {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set; cannot send email`);
  }
  return value;
}

export interface SendPasswordResetParams {
  to: string;
  /** Absolute reset URL with the plaintext token query param. */
  link: string;
  /** Optional override for the `from` address (defaults to EMAIL_FROM). */
  from?: string;
  /** Inject a `fetch` for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export interface SendPasswordResetResult {
  /** Provider message id (Resend's `id`), useful for support lookups. */
  id: string;
}

/**
 * Sends a password-reset email. Throws on transport failure or non-2xx
 * response. Never logs the link itself — only metadata (recipient, message
 * id).
 */
export async function sendPasswordReset(
  params: SendPasswordResetParams,
): Promise<SendPasswordResetResult> {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = params.from ?? requiredEnv("EMAIL_FROM");
  const fetchImpl = params.fetchImpl ?? fetch;
  const siteUrl = getSiteUrl();

  const subject = "Restablece tu contraseña de Kernelia Admin";
  const body: ResendRequest = {
    from,
    to: [params.to],
    subject,
    html: passwordResetHtml(params.link, subject, siteUrl),
    text: passwordResetText(params.link),
  };

  const res = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "<no body>");
    log.error("password_reset_send_failed", { to: params.to, status: res.status });
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new Error("Resend response missing `id`");
  }
  log.info("password_reset_sent", { to: params.to, providerId: json.id });
  return { id: json.id };
}

function passwordResetHtml(link: string, subject: string, siteUrl: string): string {
  const content = `<h1 style="font-size:20px;font-weight:600;margin:0 0 16px;color:${BRAND.foreground};letter-spacing:-0.01em;">Restablece tu contraseña</h1>
<p style="margin:0 0 12px;color:${BRAND.foreground};line-height:1.6;font-size:15px;">Has solicitado restablecer la contraseña de tu cuenta de administrador en Kernelia.</p>
<p style="margin:0 0 8px;color:${BRAND.muted};line-height:1.6;font-size:14px;">Pulsa el botón para elegir una nueva contraseña. El enlace caduca en <strong style="color:${BRAND.foreground};">30 minutos</strong> y solo puede usarse una vez.</p>
${ctaButton("Elegir nueva contraseña", link)}
<p style="margin:24px 0 0;font-size:13px;color:${BRAND.mutedFaint};line-height:1.6;">Si no has solicitado este cambio, ignora el correo. Tu contraseña actual seguirá funcionando.</p>`;
  return emailShell({
    subject,
    locale: "es",
    siteUrl,
    content,
    preheader: "Enlace válido durante 30 minutos para elegir una nueva contraseña.",
  });
}

function passwordResetText(link: string): string {
  return [
    "Restablece tu contraseña de Kernelia Admin",
    "",
    "Has solicitado restablecer tu contraseña. Pulsa este enlace para elegir una nueva:",
    link,
    "",
    "El enlace caduca en 30 minutos y solo puede usarse una vez.",
    "Si no has solicitado este cambio, ignora el correo.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Newsletter (Phase 8.C.2)
// ---------------------------------------------------------------------------

interface NewsletterCopy {
  confirmSubject: string;
  confirmHeading: string;
  confirmIntro: string;
  confirmCta: string;
  confirmFooter: string;
  confirmPreheader: string;
  digestSubject: (weekLabel: string) => string;
  digestHeading: (weekLabel: string) => string;
  digestIntro: string;
  digestPreheader: (n: number) => string;
  digestUnsubscribe: string;
  digestSourcePrefix: string;
  digestEmptyFallback: string;
}

const COPY_ES: NewsletterCopy = {
  confirmSubject: "Confirma tu suscripción a Kernelia",
  confirmHeading: "Bienvenido a Kernelia",
  confirmIntro:
    "Gracias por suscribirte a la newsletter semanal de Kernelia. Confirma tu email para empezar a recibir las novedades de IA cada domingo.",
  confirmCta: "Confirmar suscripción",
  confirmFooter:
    "Si no has solicitado esta suscripción, ignora el correo: sin confirmar no recibirás nada.",
  confirmPreheader: "Confirma tu email para activar la suscripción semanal.",
  digestSubject: (weekLabel: string) => `Kernelia · Resumen de ${weekLabel}`,
  digestHeading: (weekLabel: string) => `Resumen de la semana · ${weekLabel}`,
  digestIntro: "Lo más relevante de IA esta semana, según el agente de Kernelia.",
  digestPreheader: (n) => `${n} ${n === 1 ? "artículo" : "artículos"} seleccionados esta semana.`,
  digestUnsubscribe: "Darse de baja",
  digestSourcePrefix: "Fuente",
  digestEmptyFallback:
    "Esta semana no hay artículos por encima del umbral del agente — el envío se ha pospuesto.",
};

const COPY_EN: NewsletterCopy = {
  confirmSubject: "Confirm your Kernelia subscription",
  confirmHeading: "Welcome to Kernelia",
  confirmIntro:
    "Thanks for subscribing to the Kernelia weekly newsletter. Confirm your email to start receiving the AI digest every Sunday.",
  confirmCta: "Confirm subscription",
  confirmFooter:
    "If you didn't request this subscription, ignore the email — you won't receive anything without confirming.",
  confirmPreheader: "Confirm your email to activate the weekly subscription.",
  digestSubject: (weekLabel: string) => `Kernelia · Week of ${weekLabel}`,
  digestHeading: (weekLabel: string) => `Weekly digest · ${weekLabel}`,
  digestIntro: "The most relevant AI signal this week, picked by the Kernelia agent.",
  digestPreheader: (n) => `${n} ${n === 1 ? "article" : "articles"} curated this week.`,
  digestUnsubscribe: "Unsubscribe",
  digestSourcePrefix: "Source",
  digestEmptyFallback:
    "No articles cleared the agent's threshold this week — the digest has been skipped.",
};

function copyFor(locale: Locale): NewsletterCopy {
  return locale === "en" ? COPY_EN : COPY_ES;
}

export interface SendNewsletterConfirmationParams {
  to: string;
  locale: Locale;
  /** Absolute confirm URL with the plaintext token query param. */
  confirmUrl: string;
  from?: string;
  fetchImpl?: typeof fetch;
}

export interface SendNewsletterConfirmationResult {
  id: string;
}

/**
 * Sends the double-opt-in confirmation email. Throws on non-2xx. The
 * subscriber is NOT considered active until they click through.
 */
export async function sendNewsletterConfirmation(
  params: SendNewsletterConfirmationParams,
): Promise<SendNewsletterConfirmationResult> {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = params.from ?? requiredEnv("EMAIL_FROM");
  const fetchImpl = params.fetchImpl ?? fetch;
  const siteUrl = getSiteUrl();
  const copy = copyFor(params.locale);

  const body: ResendRequest = {
    from,
    to: [params.to],
    subject: copy.confirmSubject,
    html: confirmHtml(params.confirmUrl, copy, params.locale, siteUrl),
    text: confirmText(params.confirmUrl, copy),
  };

  const res = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "<no body>");
    log.error("newsletter_confirm_send_failed", { to: params.to, status: res.status });
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("Resend response missing `id`");
  log.info("newsletter_confirm_sent", { to: params.to, providerId: json.id });
  return { id: json.id };
}

export interface SendWeeklyDigestParams {
  to: string;
  locale: Locale;
  /** Absolute unsubscribe URL (token already embedded). */
  unsubscribeUrl: string;
  articles: DigestArticle[];
  /** Human-readable week label for the subject line (e.g. "18 May 2026"). */
  weekLabel: string;
  /**
   * Phase 8.E: absolute URL of the 1x1 tracking pixel, including the
   * `?id=<sendId>` query param. When set, the digest renders the
   * pixel + a privacy notice in the footer. `runNewsletter`
   * pre-creates the `newsletter_sends` row and constructs this URL
   * before calling us.
   */
  trackingPixelUrl?: string;
  from?: string;
  fetchImpl?: typeof fetch;
}

export interface SendWeeklyDigestResult {
  id: string;
}

/**
 * Sends one weekly-digest email to a single subscriber. The caller loops
 * over `listActiveSubscribers()` in the cron and sleeps between sends to
 * stay under Resend's free-tier rate limit (2/sec).
 */
export async function sendWeeklyDigest(
  params: SendWeeklyDigestParams,
): Promise<SendWeeklyDigestResult> {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = params.from ?? requiredEnv("EMAIL_FROM");
  const fetchImpl = params.fetchImpl ?? fetch;
  const siteUrl = getSiteUrl();
  const copy = copyFor(params.locale);

  const body: ResendRequest = {
    from,
    to: [params.to],
    subject: copy.digestSubject(params.weekLabel),
    html: digestHtml({
      articles: params.articles,
      unsubscribeUrl: params.unsubscribeUrl,
      weekLabel: params.weekLabel,
      copy,
      locale: params.locale,
      siteUrl,
      trackingPixelUrl: params.trackingPixelUrl,
    }),
    text: digestText(params.articles, params.unsubscribeUrl, copy),
  };

  const res = await fetchImpl(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "<no body>");
    log.error("newsletter_digest_send_failed", { to: params.to, status: res.status });
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("Resend response missing `id`");
  log.info("newsletter_digest_sent", { to: params.to, providerId: json.id });
  return { id: json.id };
}

function confirmHtml(link: string, copy: NewsletterCopy, locale: Locale, siteUrl: string): string {
  const content = `<h1 style="font-size:22px;font-weight:700;margin:0 0 12px;color:${BRAND.foreground};letter-spacing:-0.01em;">${escapeHtml(copy.confirmHeading)}</h1>
<p style="margin:0 0 20px;color:${BRAND.foreground};line-height:1.6;font-size:15px;">${escapeHtml(copy.confirmIntro)}</p>
${ctaButton(copy.confirmCta, link)}
<p style="margin:24px 0 0;font-size:13px;color:${BRAND.mutedFaint};line-height:1.6;">${escapeHtml(copy.confirmFooter)}</p>`;
  return emailShell({
    subject: copy.confirmSubject,
    locale,
    siteUrl,
    content,
    preheader: copy.confirmPreheader,
  });
}

function confirmText(link: string, copy: NewsletterCopy): string {
  return [copy.confirmSubject, "", copy.confirmIntro, "", link, "", copy.confirmFooter].join("\n");
}

interface DigestHtmlParams {
  articles: DigestArticle[];
  unsubscribeUrl: string;
  weekLabel: string;
  copy: NewsletterCopy;
  locale: Locale;
  siteUrl: string;
  trackingPixelUrl?: string;
}

function digestHtml({
  articles,
  unsubscribeUrl,
  weekLabel,
  copy,
  locale,
  siteUrl,
  trackingPixelUrl,
}: DigestHtmlParams): string {
  const cards = articles.map((a) => articleCard(a, copy, locale)).join("\n");

  const content = `<h1 style="font-size:22px;font-weight:700;margin:0 0 8px;color:${BRAND.foreground};letter-spacing:-0.01em;">${escapeHtml(copy.digestHeading(weekLabel))}</h1>
<p style="margin:0 0 28px;color:${BRAND.muted};line-height:1.5;font-size:14px;">${escapeHtml(copy.digestIntro)}</p>
${cards}`;

  return emailShell({
    subject: copy.digestSubject(weekLabel),
    locale,
    siteUrl,
    content,
    preheader: copy.digestPreheader(articles.length),
    unsubscribeUrl,
    unsubscribeLabel: copy.digestUnsubscribe,
    trackingPixelUrl,
  });
}

/**
 * Renders one article as a dark card. Image (if any) on top, then
 * category chip, title, summary and source on a meta line. Falls back
 * to a text-only card if `imageUrl` is null.
 */
function articleCard(article: DigestArticle, copy: NewsletterCopy, locale: Locale): string {
  const cat = categoryLabel(article.categorySlug, locale);
  const chip = cat
    ? `<div style="font-size:11px;font-weight:600;color:${BRAND.accent};letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px;">${escapeHtml(cat)}</div>`
    : "";
  const summary = article.summary
    ? `<p style="margin:8px 0 0;color:${BRAND.muted};line-height:1.55;font-size:14px;">${escapeHtml(article.summary)}</p>`
    : "";
  const meta = `<div style="margin-top:14px;font-size:12px;color:${BRAND.mutedFaint};">${escapeHtml(copy.digestSourcePrefix)}: <span style="color:${BRAND.muted};">${escapeHtml(article.sourceName)}</span></div>`;

  // The hero image cell only renders when we actually have one. Width
  // attribute is explicit (Outlook ignores CSS width on <img>) and the
  // inline `max-width:100%` keeps it responsive on narrow mobile widths.
  const imageCell = article.imageUrl
    ? `<tr><td>
  <a href="${escapeHtml(article.url)}" style="display:block;">
    <img src="${escapeHtml(article.imageUrl)}" alt="" width="544" style="display:block;width:100%;max-width:544px;height:auto;border:0;outline:none;border-top-left-radius:10px;border-top-right-radius:10px;">
  </a>
</td></tr>`
    : "";

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background-color:${BRAND.surface2};border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden;">
${imageCell}
<tr><td style="padding:18px 20px;">
${chip}
<a href="${escapeHtml(article.url)}" style="color:${BRAND.foreground};text-decoration:none;font-weight:600;font-size:16px;line-height:1.35;display:block;">${escapeHtml(article.title)}</a>
${summary}
${meta}
</td></tr>
</table>`;
}

function digestText(
  articles: DigestArticle[],
  unsubscribeUrl: string,
  copy: NewsletterCopy,
): string {
  const lines: string[] = ["Kernelia", "", copy.digestIntro, ""];
  for (const [i, a] of articles.entries()) {
    lines.push(`${i + 1}. ${a.title}`);
    if (a.summary) lines.push(`   ${a.summary}`);
    lines.push(`   ${copy.digestSourcePrefix}: ${a.sourceName}`);
    lines.push(`   ${a.url}`);
    lines.push("");
  }
  lines.push("---");
  lines.push(`${copy.digestUnsubscribe}: ${unsubscribeUrl}`);
  return lines.join("\n");
}
