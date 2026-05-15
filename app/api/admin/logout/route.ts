import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  revokeSession,
  verifySessionCookieValue,
} from "@/lib/auth/sessions";
import { serialiseSessionLogoutCookie } from "@/lib/auth/cookies";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/logout
 *
 * Invalidates the server-side session row, expires the cookie, redirects to
 * `/admin/login`. Always 303 even if the cookie was already gone — logout
 * should be idempotent from the user's perspective.
 */
export async function POST(req: Request): Promise<Response> {
  const insecure = process.env.NODE_ENV !== "production";
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const sessionId = verifySessionCookieValue(cookie);
  if (sessionId) {
    try {
      await revokeSession(sessionId);
    } catch {
      // Best effort. We always clear the cookie below.
    }
  }
  const origin = pickOrigin(req);
  const res = NextResponse.redirect(new URL("/admin/login", origin), { status: 303 });
  res.headers.append("Set-Cookie", serialiseSessionLogoutCookie({ insecure }));
  return res;
}

function pickOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}
