import { insertAnalyticsEvent } from "@/db/queries/analytics";
import { buildAnalyticsEvent } from "@/lib/analytics/event";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { pickClientIp } from "@/lib/client-ip";
import { createLogger } from "@/lib/logger";
import { getSiteUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("analytics_pulse");

/**
 * POST /api/pulse — first-party analytics collector (Phase 9.A).
 *
 * Named "pulse" rather than "track"/"analytics"/"collect" on purpose:
 * generic content blockers match those path fragments, and we'd lose
 * exactly the privacy-conscious readers whose visits are cookieless
 * and anonymous anyway.
 *
 * Contract: always answers 204 with an empty body, whether the hit was
 * stored, dropped as a bot, malformed or rate-limited. The beacon never
 * reads the response, and a uniform answer gives scripted clients no
 * signal to tune against.
 *
 * Accepts the `text/plain` body that `navigator.sendBeacon` sends (no
 * CORS preflight) as well as `application/json`.
 */

/** 120 hits/min per IP: generous for a human, a wall for a loop. */
const RATE_LIMIT = { max: 120, windowMs: 60_000 };
const MAX_BODY_BYTES = 4_096;

function noContent(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  // PR previews share the production database. Their visits are the
  // operator reviewing a branch, not audience.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return noContent();

  const ip = pickClientIp(request);
  if (!consumeRateLimit(`pulse:${ip}`, RATE_LIMIT).allowed) return noContent();

  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length === 0 || raw.length > MAX_BODY_BYTES) return noContent();
    payload = JSON.parse(raw);
  } catch {
    return noContent();
  }

  const built = buildAnalyticsEvent({
    payload,
    ip,
    userAgent: request.headers.get("user-agent"),
    country: request.headers.get("x-vercel-ip-country"),
    ownHost: new URL(getSiteUrl()).hostname,
  });
  if (!built.ok) {
    if (built.reason === "no_secret") log.warn("dropped_no_secret");
    return noContent();
  }

  try {
    await insertAnalyticsEvent(built.row);
  } catch (err) {
    // Losing one hit is fine; surfacing a 500 to the page is not.
    log.warn("insert_failed", { reason: err instanceof Error ? err.message : String(err) });
  }
  return noContent();
}
