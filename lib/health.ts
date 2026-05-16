import { desc, sql } from "drizzle-orm";
import { db } from "@/db";
import { articles } from "@/db/schema";

/**
 * Shared health probe. Drives both the public `/api/health` endpoint and the
 * admin dashboard's health card. Keeping a single function ensures the two
 * surfaces never drift — and lets the admin call the probe directly via
 * function invocation instead of an HTTP round-trip back to its own server.
 */

export interface HealthCounts {
  total: number;
  classified: number;
  pending: number;
  failed: number;
}

export type HealthResult =
  | {
      status: "ok";
      /** Wall-clock duration of the probe (ms). Proxy for DB round-trip latency. */
      uptimeMs: number;
      /** ISO timestamp of the newest `articles.ingested_at`, or null on an empty DB. */
      lastIngestAt: string | null;
      articles: HealthCounts;
      ts: string;
    }
  | {
      status: "error";
      reason: string;
      ts: string;
    };

/**
 * Runs the three independent DB calls in parallel: a `SELECT 1` ping, the
 * latest `ingested_at`, and the per-status counts. If any leg throws, the
 * outer catch surfaces a 503-shaped error result. Callers decide how to
 * present it (HTTP status, banner, pill, etc.).
 */
export async function probeHealth(): Promise<HealthResult> {
  const startedAt = Date.now();
  try {
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

    return {
      status: "ok",
      uptimeMs: Date.now() - startedAt,
      lastIngestAt: lastIngestRow?.at ? lastIngestRow.at.toISOString() : null,
      articles: counts ?? { total: 0, classified: 0, pending: 0, failed: 0 },
      ts: new Date().toISOString(),
    };
  } catch (err) {
    return {
      status: "error",
      reason: err instanceof Error ? err.message : "unknown",
      ts: new Date().toISOString(),
    };
  }
}
