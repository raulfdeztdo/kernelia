import { NextResponse } from "next/server";
import { confirmByTokenHash } from "@/db/queries/newsletter";
import { hashToken } from "@/lib/newsletter/tokens";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("newsletter_confirm");

/**
 * GET /api/newsletter/confirm?token=...
 *
 * Redirects to a server-rendered page that explains the outcome. We do NOT
 * branch the page on the result; the rendered copy is identical for
 * "confirmed", "already used", "expired-by-rotation", or "unknown token".
 * Two reasons:
 *   - Avoids an oracle for token enumeration.
 *   - The user-facing message is the same either way ("you're subscribed").
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/newsletter/confirmed", url.origin), { status: 303 });
  }
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
  // Honour the locale prefix if the link was visited from /en (digest emails
  // include the locale on the URL); we look at the `lang` query param the
  // subscribe-flow puts there.
  const lang = url.searchParams.get("lang");
  const target = lang === "en" ? "/en/newsletter/confirmed" : "/newsletter/confirmed";
  return NextResponse.redirect(new URL(target, url.origin), { status: 303 });
}
