import { NextResponse } from "next/server";
import { MagicLinkVerificationError, verifyAndConsumeMagicLink } from "@/lib/auth/tokens";
import { createSession } from "@/lib/auth/sessions";
import { serialiseSessionCookie } from "@/lib/auth/cookies";
import { getUserById, setUserLastLogin } from "@/db/queries/users";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("auth_callback");

/**
 * GET /admin/auth/callback?token=<plaintext>
 *
 * 1. Pull plaintext token out of the URL.
 * 2. Verify + atomic-consume (`tokens.ts` rejects expired / used / unknown).
 * 3. Look up the user; if they were deactivated between request and callback,
 *    refuse the session.
 * 4. Create a server-side session row, set the signed cookie, redirect to
 *    `/admin`. On any failure, redirect to `/admin/login?error=<reason>`.
 *
 * Route handlers don't execute parent layouts, so the admin private guard
 * doesn't trip here — by construction the request is unauthenticated until
 * we set the cookie at the very end.
 */
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const insecure = process.env.NODE_ENV !== "production";

  if (!token) {
    return redirectToLogin(req, "invalid");
  }

  let userId: string;
  try {
    const result = await verifyAndConsumeMagicLink(token);
    userId = result.userId;
  } catch (err) {
    if (err instanceof MagicLinkVerificationError) {
      log.warn("token_rejected", { reason: err.reason });
      return redirectToLogin(req, err.reason === "used" ? "used" : err.reason);
    }
    log.error("token_verify_threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return redirectToLogin(req, "invalid");
  }

  const user = await getUserById(userId);
  if (!user || !user.active) {
    log.warn("user_inactive_or_missing", { userId });
    return redirectToLogin(req, "revoked");
  }

  const session = await createSession(user.id);
  await setUserLastLogin(user.id, new Date());

  const origin = pickOrigin(req);
  const res = NextResponse.redirect(new URL("/admin", origin), { status: 303 });
  res.headers.append("Set-Cookie", serialiseSessionCookie(session.signedCookie, { insecure }));
  log.info("session_created", { userId: user.id });
  return res;
}

function redirectToLogin(req: Request, reason: string): Response {
  const origin = pickOrigin(req);
  return NextResponse.redirect(new URL(`/admin/login?error=${encodeURIComponent(reason)}`, origin), {
    status: 303,
  });
}

function pickOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}
