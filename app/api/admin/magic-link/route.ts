import { NextResponse } from "next/server";
import { requestMagicLink } from "@/lib/auth/magic-link-flow";

// Force this route to the Node runtime (default), but pin the segment as
// dynamic — we never want this cached.
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/magic-link
 *
 * Accepts `application/x-www-form-urlencoded` (from the login form) or JSON.
 * Always responds with the same constant copy — never leaks whether the
 * email exists. The flow handles rate-limits, lookup, token generation and
 * email delivery internally and reports the outcome to logs only.
 *
 * On success (or any benign failure), redirect back to `/admin/login?sent=1`
 * so the no-JS happy path lands on the same "check your inbox" banner. On
 * rate-limit, redirect to `/admin/login?error=rate_limited`. Hard server
 * errors propagate as 500 so they show up in monitoring instead of being
 * swallowed silently.
 */
export async function POST(req: Request): Promise<Response> {
  const rawEmail = await readEmailFromRequest(req);
  const origin = pickOrigin(req);
  const ip = pickClientIp(req);

  const outcome = await requestMagicLink({ rawEmail, origin, ip });

  switch (outcome.kind) {
    case "rate_limited":
      return redirectBack(req, "/admin/login?error=rate_limited");
    case "error":
      // Hard failure (e.g. Resend down). Surface as 500 so platform
      // monitoring catches it; do NOT swallow into "sent=1".
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    case "invalid_email":
    case "unknown_email":
    case "inactive_user":
    case "sent":
      // Constant-copy path. We always show the "check your inbox" banner.
      return redirectBack(req, "/admin/login?sent=1");
  }
}

async function readEmailFromRequest(req: Request): Promise<unknown> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      return body.email;
    } catch {
      return undefined;
    }
  }
  // Default: HTML form post.
  try {
    const form = await req.formData();
    const value = form.get("email");
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

function pickOrigin(req: Request): string {
  // Trust `x-forwarded-host`/`x-forwarded-proto` on Vercel; fall back to the
  // request URL's origin for local dev.
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
