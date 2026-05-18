import { NextResponse } from "next/server";
import { getPublicStats } from "@/lib/stats";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
// Cached at the edge for an hour (s-maxage=3600) with stale-while-revalidate
// so the next viewer after expiry still gets an instant response while we
// refresh in the background. The route itself stays force-dynamic on the
// server side; the cache lives at the Vercel CDN layer.
export const dynamic = "force-dynamic";

const log = createLogger("stats");

const corsHeaders = {
  // Public transparency endpoint — anyone may scrape, no auth, no PII.
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  try {
    const stats = await getPublicStats();
    return NextResponse.json(stats, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (err) {
    log.error("stats_failed", { message: err instanceof Error ? err.message : "unknown" });
    return NextResponse.json(
      { error: "stats_unavailable" },
      { status: 503, headers: { ...corsHeaders, "Cache-Control": "no-store" } },
    );
  }
}
