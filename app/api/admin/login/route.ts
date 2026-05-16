import { NextResponse } from "next/server";
import { attemptLogin } from "@/lib/auth/login-flow";
import { createSession } from "@/lib/auth/sessions";
import { serialiseSessionCookie } from "@/lib/auth/cookies";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("admin_login");

/**
 * POST /api/admin/login
 *
 * Accepts `application/x-www-form-urlencoded` (from the no-JS login form) or
 * JSON `{ email, password }`. Verifies credentials via `attemptLogin`,
 * creates a session row, sets the signed `__Host-kernelia-session` cookie
 * and redirects to `/admin`.
 *
 * On any benign failure (wrong creds / unknown user / inactive user) the
 * response is identical: redirect to `/admin/login?error=invalid_credentials`.
 * Account-enumeration is the threat we're shutting down: the form must
 * behave the same whether the email exists or not.
 *
 * Hard server errors (DB down, session insert fails) bubble up as a 500 so
 * platform monitoring catches them rather than being swallowed as "invalid".
 */
export async function POST(req: Request): Promise<Response> {
  const rawBody = await readCredentialsFromRequest(req);
  const ip = pickClientIp(req);
  const insecure = process.env.NODE_ENV !== "production";

  const outcome = await attemptLogin({ rawBody, ip });

  switch (outcome.kind) {
    case "invalid_body":
      return redirectBack(req, "/admin/login?error=invalid_credentials");
    case "rate_limited":
      return redirectBack(req, "/admin/login?error=rate_limited");
    case "invalid_credentials":
    case "inactive_user":
      // Same generic copy for all three: don't reveal which one tripped.
      return redirectBack(req, "/admin/login?error=invalid_credentials");
    case "ok": {
      try {
        const session = await createSession(outcome.user.id);
        const origin = pickOrigin(req);
        const res = NextResponse.redirect(new URL("/admin", origin), { status: 303 });
        res.headers.append(
          "Set-Cookie",
          serialiseSessionCookie(session.signedCookie, { insecure }),
        );
        log.info("session_created", { userId: outcome.user.id });
        return res;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("session_create_failed", { userId: outcome.user.id, error: message });
        return NextResponse.json({ error: "internal_error" }, { status: 500 });
      }
    }
  }
}

async function readCredentialsFromRequest(req: Request): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      return await req.json();
    } catch {
      return undefined;
    }
  }
  try {
    const form = await req.formData();
    const email = form.get("email");
    const password = form.get("password");
    return {
      email: typeof email === "string" ? email : undefined,
      password: typeof password === "string" ? password : undefined,
    };
  } catch {
    return undefined;
  }
}

function pickOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

function pickClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

function redirectBack(req: Request, path: string): Response {
  const origin = pickOrigin(req);
  return NextResponse.redirect(new URL(path, origin), { status: 303 });
}
