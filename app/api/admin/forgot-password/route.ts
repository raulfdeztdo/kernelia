import { NextResponse } from "next/server";
import { requestPasswordReset } from "@/lib/auth/forgot-password-flow";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/forgot-password
 *
 * Accepts `application/x-www-form-urlencoded` (no-JS form) or JSON. Always
 * redirects to `/admin/forgot-password?sent=1` on any benign outcome — the
 * copy is constant and never reveals whether the email is registered, in
 * order to prevent account enumeration.
 *
 * Rate-limit hits → `?error=rate_limited`. Hard email-provider failure →
 * 500 so platform monitoring catches it instead of silently telling the
 * user "check your inbox".
 */
export async function POST(req: Request): Promise<Response> {
  const rawEmail = await readEmailFromRequest(req);
  const origin = pickOrigin(req);
  const ip = pickClientIp(req);

  const outcome = await requestPasswordReset({ rawEmail, origin, ip });

  switch (outcome.kind) {
    case "rate_limited":
      return redirectBack(req, "/admin/forgot-password?error=rate_limited");
    case "error":
      return NextResponse.json({ error: "internal_error" }, { status: 500 });
    case "invalid_email":
    case "unknown_email":
    case "inactive_user":
    case "sent":
      return redirectBack(req, "/admin/forgot-password?sent=1");
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
  try {
    const form = await req.formData();
    const value = form.get("email");
    return typeof value === "string" ? value : undefined;
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
