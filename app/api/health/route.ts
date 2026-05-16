import { NextResponse } from "next/server";
import { probeHealth } from "@/lib/health";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("health");

/**
 * Lightweight health probe. Returns 200 only when the DB ping succeeds.
 * Surfaces minimal stats useful for uptime monitoring without leaking data.
 *
 * The actual probe lives in `lib/health.ts` and is shared with the admin
 * dashboard so both surfaces report identical state.
 */
export async function GET() {
  const result = await probeHealth();
  if (result.status === "error") {
    log.error("health_failed", { reason: result.reason });
    return NextResponse.json(result, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return NextResponse.json(result, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
