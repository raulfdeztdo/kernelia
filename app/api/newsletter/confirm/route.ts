import { NextResponse } from "next/server";
import { confirmByTokenHash } from "@/db/queries/newsletter";
import { hashToken } from "@/lib/newsletter/tokens";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("newsletter_confirm");

/**
 * POST /api/newsletter/confirm
 *
 * Mutating endpoint — only reachable via form submission from the
 * `/[locale]/newsletter/confirm` landing page. Body:
 *   - `token`: plaintext confirm token from the signup email.
 *   - `lang`: locale of the success page to redirect to (es/en).
 *
 * Why POST and not GET: email scanners (Outlook, Defender, Mimecast,
 * etc.) pre-fetch every URL in an email. If confirm were a GET,
 * those scanners would silently activate any subscription before the
 * recipient even sees the email — defeating the double-opt-in
 * guarantee and enabling spoofed-signup attacks (someone subscribes
 * `victim@example.com`, victim's mailbox scanner confirms it).
 *
 * Same hardening pattern as `/api/newsletter/unsubscribe`. Always
 * redirects to `/[locale]/newsletter/confirmed` regardless of whether
 * the token matched, to avoid leaking which tokens are valid.
 */
export async function POST(req: Request): Promise<Response> {
  const { token, lang } = await readBody(req);
  if (token) {
    try {
      const row = await confirmByTokenHash(hashToken(token));
      if (row) {
        log.info("subscriber_confirmed", { subscriberId: row.id });
      } else {
        log.info("confirm_token_miss");
      }
    } catch (err) {
      log.error("confirm_failed", { error: err instanceof Error ? err.message : "unknown" });
    }
  }
  const origin = pickOrigin(req);
  const target = lang === "en" ? "/en/newsletter/confirmed" : "/newsletter/confirmed";
  return NextResponse.redirect(new URL(target, origin), { status: 303 });
}

/**
 * Defensive GET handler: a stale email client or browser prefetch that
 * still hits the API URL directly gets redirected to the confirmation
 * page (which holds the POST form). We do NOT mutate here. Token is
 * propagated so the page renders the form pre-filled.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";
  const lang = url.searchParams.get("lang");
  const base = lang === "en" ? "/en/newsletter/confirm" : "/newsletter/confirm";
  const target = new URL(base, url.origin);
  if (token) target.searchParams.set("token", token);
  return NextResponse.redirect(target, { status: 303 });
}

async function readBody(
  req: Request,
): Promise<{ token: string; lang: string | null }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      const token = typeof body.token === "string" ? body.token : "";
      const lang = typeof body.lang === "string" ? body.lang : null;
      return { token, lang };
    } catch {
      return { token: "", lang: null };
    }
  }
  try {
    const form = await req.formData();
    const token = form.get("token");
    const lang = form.get("lang");
    return {
      token: typeof token === "string" ? token : "",
      lang: typeof lang === "string" ? lang : null,
    };
  } catch {
    return { token: "", lang: null };
  }
}

function pickOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}
