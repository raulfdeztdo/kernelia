import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@/db/queries/newsletter";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("newsletter_unsubscribe");

/**
 * POST /api/newsletter/unsubscribe
 *
 * Mutating endpoint — only reachable via form submission from the
 * `/[locale]/newsletter/unsubscribe` confirmation page. Body shape:
 *   - `token`: the plaintext unsubscribe token from the digest email.
 *   - `lang`: locale of the landing page to redirect to (es/en).
 *
 * Why POST and not GET: email scanners (Microsoft Defender, Mimecast,
 * Proofpoint, etc.) pre-fetch every URL in an email to inspect it. If the
 * unsubscribe were a GET, those scanners would deactivate the subscriber
 * before they even read the digest. The same applies to browser prefetch
 * and link-preview bots in Slack/WhatsApp. RFC 8058 codifies this for
 * inbox-side "Unsubscribe" buttons; we apply the same hygiene to the
 * in-email link.
 *
 * Idempotent: re-submitting the same token is a no-op (the row already
 * has `unsubscribed_at` set). We always render `/newsletter/unsubscribed`
 * regardless of whether the token matched, to avoid leaking whether a
 * given token is valid.
 */
export async function POST(req: Request): Promise<Response> {
  const { token, lang } = await readBody(req);
  if (token) {
    try {
      const row = await unsubscribeByToken(token);
      if (row) {
        log.info("subscriber_unsubscribed", { subscriberId: row.id });
      } else {
        log.info("unsubscribe_token_miss");
      }
    } catch (err) {
      log.error("unsubscribe_failed", {
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }
  const origin = pickOrigin(req);
  const target = lang === "en" ? "/en/newsletter/unsubscribed" : "/newsletter/unsubscribed";
  return NextResponse.redirect(new URL(target, origin), { status: 303 });
}

// Intentionally no GET handler. The email points users at the
// `/[locale]/newsletter/unsubscribe` page (HTML form), not at this
// route. Anything that lands here with GET is either a scanner
// prefetch or a manual URL paste; both are happy with a 405.

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
