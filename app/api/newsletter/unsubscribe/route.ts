import { NextResponse } from "next/server";
import { unsubscribeByToken } from "@/db/queries/newsletter";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("newsletter_unsubscribe");

/**
 * GET /api/newsletter/unsubscribe?token=...
 *
 * Idempotent: clicking a digest's unsubscribe link more than once is fine.
 * Always redirects to the public "unsubscribed" page — the user-facing copy
 * is the same on success, repeat-click, or unknown token.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/newsletter/unsubscribed", url.origin), { status: 303 });
  }
  try {
    const row = await unsubscribeByToken(token);
    if (row) {
      log.info("subscriber_unsubscribed", { subscriberId: row.id });
    } else {
      log.info("unsubscribe_token_miss");
    }
  } catch (err) {
    log.error("unsubscribe_failed", { error: err instanceof Error ? err.message : "unknown" });
  }
  const lang = url.searchParams.get("lang");
  const target = lang === "en" ? "/en/newsletter/unsubscribed" : "/newsletter/unsubscribed";
  return NextResponse.redirect(new URL(target, url.origin), { status: 303 });
}
