import { createLogger } from "@/lib/logger";

/**
 * Email helper for the admin backoffice.
 *
 * Wraps the Resend HTTP API directly (no SDK) so the dependency surface
 * stays at zero new packages. If we ever migrate provider, this is the
 * only file that changes.
 *
 * Required env vars (validated lazily at first call):
 *   - RESEND_API_KEY: API key from <https://resend.com/api-keys>
 *   - EMAIL_FROM:     verified sender ("Kernelia <admin@kernelia.dev>")
 *                     During domain-verification gap, use
 *                     "Kernelia <onboarding@resend.dev>" — emails will
 *                     only deliver to the Resend account's own inbox.
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

export interface SendMagicLinkParams {
  to: string;
  /** Absolute callback URL with the plaintext token. */
  link: string;
  /** Optional override for the `from` address (defaults to EMAIL_FROM). */
  from?: string;
  /** Inject a `fetch` for tests. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

export interface SendMagicLinkResult {
  /** Provider message id (Resend's `id`), useful for support lookups. */
  id: string;
}

/**
 * Sends a magic-link email. Throws on transport failure or non-2xx response.
 * Never logs the link itself — only metadata (recipient, message id).
 */
export async function sendMagicLink(params: SendMagicLinkParams): Promise<SendMagicLinkResult> {
  const apiKey = requiredEnv("RESEND_API_KEY");
  const from = params.from ?? requiredEnv("EMAIL_FROM");
  const fetchImpl = params.fetchImpl ?? fetch;

  const body: ResendRequest = {
    from,
    to: [params.to],
    subject: "Tu enlace de acceso a Kernelia",
    html: magicLinkHtml(params.link),
    text: magicLinkText(params.link),
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
    log.error("magic_link_send_failed", { to: params.to, status: res.status });
    throw new Error(`Resend ${res.status}: ${detail.slice(0, 200)}`);
  }

  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new Error("Resend response missing `id`");
  }
  log.info("magic_link_sent", { to: params.to, providerId: json.id });
  return { id: json.id };
}

function magicLinkHtml(link: string): string {
  // Plain inline HTML — no JSX, no @react-email. Keeps build deps untouched.
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0a0a0a">
<h1 style="font-size:20px;margin:0 0 16px">Acceso a Kernelia</h1>
<p>Pulsa el siguiente botón para entrar al panel de administración. El enlace caduca en 15 minutos y solo puede usarse una vez.</p>
<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="background:#0a0a0a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;display:inline-block">Entrar al panel</a></p>
<p style="font-size:13px;color:#525252">Si no has pedido este enlace, ignora el correo. Nadie podrá acceder con él sin tu bandeja de entrada.</p>
</body></html>`;
}

function magicLinkText(link: string): string {
  return [
    "Acceso a Kernelia",
    "",
    "Pulsa este enlace para entrar al panel de administración:",
    link,
    "",
    "El enlace caduca en 15 minutos y solo puede usarse una vez.",
    "Si no has pedido este enlace, ignora el correo.",
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
