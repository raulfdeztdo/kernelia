import { desc, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { articles } from "@/db/schema";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("health");

/**
 * Lightweight health probe. Returns 200 only when the DB ping succeeds.
 * Surfaces minimal stats useful for uptime monitoring without leaking data.
 */
export async function GET() {
  const startedAt = Date.now();
  try {
    // The DB ping, latest-ingest lookup, and counts query are all
    // independent — race them so the probe finishes in one round-trip
    // worth of latency instead of three. If any leg throws, the
    // outer catch surfaces the failure.
    const [, lastIngestRows, countsRows] = await Promise.all([
      db.execute(sql`select 1`),
      db
        .select({ at: articles.ingestedAt })
        .from(articles)
        .orderBy(desc(articles.ingestedAt))
        .limit(1),
      db
        .select({
          total: sql<number>`count(*)::int`,
          classified: sql<number>`count(*) filter (where ${articles.status} = 'classified')::int`,
          pending: sql<number>`count(*) filter (where ${articles.status} = 'pending')::int`,
          failed: sql<number>`count(*) filter (where ${articles.status} = 'failed')::int`,
        })
        .from(articles),
    ]);
    const [lastIngestRow] = lastIngestRows;
    const [counts] = countsRows;

    const body = {
      status: "ok" as const,
      uptimeMs: Date.now() - startedAt,
      lastIngestAt: lastIngestRow?.at ? lastIngestRow.at.toISOString() : null,
      articles: counts ?? { total: 0, classified: 0, pending: 0, failed: 0 },
      ts: new Date().toISOString(),
    };
    return NextResponse.json(body, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    log.error("health_failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        status: "error" as const,
        reason: err instanceof Error ? err.message : "unknown",
        ts: new Date().toISOString(),
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
