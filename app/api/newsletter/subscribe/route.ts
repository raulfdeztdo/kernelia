import { NextResponse } from "next/server";
import { subscribeToNewsletter } from "@/lib/newsletter/subscribe-flow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/newsletter/subscribe
 *
 * Accepts JSON `{ email, locale }` or `application/x-www-form-urlencoded`
 * (no-JS form fallback). Always returns the same 200 envelope so an attacker
 * cannot enumerate addresses by probing this endpoint:
 *
 *   { ok: true }
 *
 * Rate-limit hits → 429 with `Retry-After`. Internal errors → 500.
 *
 * The form on /about posts JSON via fetch; the no-JS branch posts the form
 * and we redirect back to /about?subscribed=1.
 */
export async function POST(req: Request): Promise<Response> {
  const { email, locale, isJson } = await readBody(req);
  const origin = pickOrigin(req);
  const ip = pickClientIp(req);

  const outcome = await subscribeToNewsletter({ rawEmail: email, rawLocale: locale, origin, ip });

  if (isJson) {
    switch (outcome.kind) {
      case "rate_limited":
        return NextResponse.json(
          { ok: false, error: "rate_limited" },
          {
            status: 429,
            headers: { "Retry-After": String(Math.ceil(outcome.retryAfterMs / 1000)) },
          },
        );
      case "invalid_email":
        return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
      case "error":
        return NextResponse.json({ ok: false, error: "internal_error" }, { status: 500 });
      case "sent":
      case "noop_already_active":
        // Uniform response across new / re-armed / already-active. The
        // already-active branch never sent an email and never mutated the
        // row, but externally it MUST look identical so the endpoint
        // can't be used to enumerate active subscribers.
        return NextResponse.json({ ok: true });
    }
  }

  // Form fallback: redirect back to /about with a status flag the page reads.
  switch (outcome.kind) {
    case "rate_limited":
      return redirectBack(req, "/about?subscribed=rate_limited", origin);
    case "invalid_email":
      return redirectBack(req, "/about?subscribed=invalid", origin);
    case "error":
      return redirectBack(req, "/about?subscribed=error", origin);
    case "sent":
    case "noop_already_active":
      return redirectBack(req, "/about?subscribed=1", origin);
  }
}

async function readBody(
  req: Request,
): Promise<{ email: unknown; locale: unknown; isJson: boolean }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      return { email: body.email, locale: body.locale, isJson: true };
    } catch {
      return { email: undefined, locale: undefined, isJson: true };
    }
  }
  try {
    const form = await req.formData();
    const email = form.get("email");
    const locale = form.get("locale");
    return {
      email: typeof email === "string" ? email : undefined,
      locale: typeof locale === "string" ? locale : undefined,
      isJson: false,
    };
  } catch {
    return { email: undefined, locale: undefined, isJson: false };
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

function redirectBack(req: Request, path: string, origin: string): Response {
  // Honour the locale prefix of the referring page so a /en/about form
  // round-trips back to /en/about, not the default-locale /about.
  const ref = req.headers.get("referer");
  if (ref) {
    try {
      const refUrl = new URL(ref);
      // `pathname` of /en/about is "/en/about"; we only care about the
      // first segment to keep locale-prefixed redirects working.
      const seg = refUrl.pathname.split("/").filter(Boolean)[0];
      if (seg === "en") {
        return NextResponse.redirect(new URL(`/en${path}`, origin), { status: 303 });
      }
    } catch {
      // fall through
    }
  }
  return NextResponse.redirect(new URL(path, origin), { status: 303 });
}
