import { beginCronRun, endCronRun, ingestStatus } from "@/lib/cron-logging";
import { runIngest, type IngestSummary } from "@/lib/ingest/run";

/**
 * One ingest tick with its `cron_runs` bookkeeping. Shared by the Vercel
 * route (`/api/cron/ingest`, now a manual fallback) and the Hepha worker
 * (`scripts/worker.ts ingest`), which runs it on the Pi since phase 9.D so
 * the 3-hourly RSS fetch costs no Vercel CPU.
 */
export async function runIngestJob(): Promise<
  { ok: true; summary: IngestSummary } | { ok: false; error: string }
> {
  const startedAt = new Date();
  // Phase 8.D: pre-create cron_runs row so insertPendingArticles can
  // stamp `articles.ingested_in_run`. Best-effort — null on failure.
  const cronRunId = await beginCronRun({ job: "ingest", startedAt });
  try {
    const summary = await runIngest({ cronRunId });
    await endCronRun(
      {
        id: cronRunId,
        status: ingestStatus(summary.totals),
        finishedAt: new Date(),
        summary: summary as unknown as Record<string, unknown>,
      },
      "ingest",
      startedAt,
    );
    return { ok: true, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await endCronRun(
      {
        id: cronRunId,
        status: "failed",
        finishedAt: new Date(),
        summary: { error: message },
        errorMessage: message,
      },
      "ingest",
      startedAt,
    );
    return { ok: false, error: message };
  }
}
