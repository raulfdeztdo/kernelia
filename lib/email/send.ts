import { createLogger } from "@/lib/logger";
import type { DigestArticle } from "@/lib/newsletter/digest";
import type { Locale } from "@/db/schema";

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
 *
 * History: started in Phase 7.F with password-reset only (replacing the
 * magic-link login). Phase 8.C.2 added the newsletter confirmation and
 * weekly-digest emails — same Resend client, same env vars.
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

  const body: ResendRequest = {
    from,
    to: [params.to],
    subject: "Restablece tu contraseña de Kernelia Admin",
    html: passwordResetHtml(params.link),
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

function passwordResetHtml(link: string): string {
  // Plain inline HTML — no JSX, no @react-email. Keeps build deps untouched.
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0a0a0a">
<h1 style="font-size:20px;margin:0 0 16px">Restablece tu contraseña</h1>
<p>Has solicitado restablecer la contraseña de tu cuenta de administrador en Kernelia. Pulsa el botón para elegir una nueva contraseña. El enlace caduca en 30 minutos y solo puede usarse una vez.</p>
<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#0a0a0a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block">Elegir nueva contraseña</a></p>
<p style="font-size:13px;color:#525252">Si no has solicitado este cambio, ignora el correo. Tu contraseña actual seguirá funcionando.</p>
</body></html>`;
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

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ---------------------------------------------------------------------------
// Newsletter (Phase 8.C.2)
// ---------------------------------------------------------------------------

interface NewsletterCopy {
  confirmSubject: string;
  confirmIntro: string;
  confirmCta: string;
  confirmFooter: string;
  digestSubject: (weekLabel: string) => string;
  digestIntro: string;
  digestUnsubscribe: string;
  digestSourcePrefix: string;
  digestEmptyFallback: string;
}

const COPY_ES: NewsletterCopy = {
  confirmSubject: "Confirma tu suscripción a Kernelia",
  confirmIntro:
    "Gracias por suscribirte a la newsletter semanal de Kernelia. Confirma tu email para empezar a recibir las novedades de IA cada domingo.",
  confirmCta: "Confirmar suscripción",
  confirmFooter:
    "Si no has solicitado esta suscripción, ignora el correo: sin confirmar no recibirás nada.",
  digestSubject: (weekLabel: string) => `Kernelia · Resumen de ${weekLabel}`,
  digestIntro: "Lo más relevante de IA esta semana, según el agente de Kernelia.",
  digestUnsubscribe: "Darse de baja",
  digestSourcePrefix: "Fuente",
  digestEmptyFallback:
    "Esta semana no hay artículos por encima del umbral del agente — el envío se ha pospuesto.",
};

const COPY_EN: NewsletterCopy = {
  confirmSubject: "Confirm your Kernelia subscription",
  confirmIntro:
    "Thanks for subscribing to the Kernelia weekly newsletter. Confirm your email to start receiving the AI digest every Sunday.",
  confirmCta: "Confirm subscription",
  confirmFooter:
    "If you didn't request this subscription, ignore the email — you won't receive anything without confirming.",
  digestSubject: (weekLabel: string) => `Kernelia · Week of ${weekLabel}`,
  digestIntro: "The most relevant AI signal this week, picked by the Kernelia agent.",
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
  const copy = copyFor(params.locale);

  const body: ResendRequest = {
    from,
    to: [params.to],
    subject: copy.confirmSubject,
    html: confirmHtml(params.confirmUrl, copy),
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
  const copy = copyFor(params.locale);

  const body: ResendRequest = {
    from,
    to: [params.to],
    subject: copy.digestSubject(params.weekLabel),
    html: digestHtml(params.articles, params.unsubscribeUrl, copy),
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

function confirmHtml(link: string, copy: NewsletterCopy): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0a0a0a">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(copy.confirmSubject)}</h1>
<p>${escapeHtml(copy.confirmIntro)}</p>
<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#0a0a0a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block">${escapeHtml(copy.confirmCta)}</a></p>
<p style="font-size:13px;color:#525252">${escapeHtml(copy.confirmFooter)}</p>
</body></html>`;
}

function confirmText(link: string, copy: NewsletterCopy): string {
  return [copy.confirmSubject, "", copy.confirmIntro, "", link, "", copy.confirmFooter].join("\n");
}

function digestHtml(
  articles: DigestArticle[],
  unsubscribeUrl: string,
  copy: NewsletterCopy,
): string {
  const items = articles
    .map((a) => {
      const summary = a.summary ? `<p style="margin:6px 0 0;color:#404040">${escapeHtml(a.summary)}</p>` : "";
      const chip = a.categorySlug
        ? `<span style="display:inline-block;margin-right:8px;padding:1px 8px;border-radius:9999px;background:#f5f5f5;color:#525252;font-size:11px;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(a.categorySlug)}</span>`
        : "";
      return `<li style="margin:0 0 20px;padding:0;list-style:none">
  <a href="${escapeHtml(a.url)}" style="color:#0a0a0a;text-decoration:none;font-weight:600;font-size:16px;line-height:1.35">${escapeHtml(a.title)}</a>
  ${summary}
  <div style="margin-top:8px;font-size:12px;color:#737373">${chip}<span>${escapeHtml(copy.digestSourcePrefix)}: ${escapeHtml(a.sourceName)}</span></div>
</li>`;
    })
    .join("\n");

  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#0a0a0a">
<h1 style="font-size:22px;margin:0 0 8px">Kernelia</h1>
<p style="margin:0 0 24px;color:#525252">${escapeHtml(copy.digestIntro)}</p>
<ol style="padding:0;margin:0">${items}</ol>
<hr style="margin:32px 0;border:0;border-top:1px solid #e5e5e5">
<p style="font-size:12px;color:#737373"><a href="${escapeHtml(unsubscribeUrl)}" style="color:#737373">${escapeHtml(copy.digestUnsubscribe)}</a></p>
</body></html>`;
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
