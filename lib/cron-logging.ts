import { finishCronRun, recordCronRun, startCronRun } from "@/db/queries/cron-runs";
import { createLogger } from "@/lib/logger";
import type { CronJob, CronRunStatus } from "@/db/schema";

/**
 * Persists one cron tick into `cron_runs`. Phase 8.D moved this from a
 * one-shot insert at the end of every handler to a two-phase flow so
 * child writes can carry the cron-run FK as they happen:
 *
 *   1. `beginCronRun({ job, startedAt })` at the very top → returns
 *      the run id (or `null` if the DB hiccupped — we never block the
 *      tick on a logging error).
 *   2. `endCronRun({ id, status, ... })` at the very end, regardless
 *      of success or failure.
 *
 * Both errors are swallowed: a transient DB issue on the logging
 * layer must never crash a cron tick that already did its real work.
 *
 * `logCronRun` is kept as a backwards-compatible one-shot helper for
 * code paths that don't need the FK (it inserts a single row with the
 * final status directly).
 */

const log = createLogger("cron_logging");

export interface LogCronRunParams {
  job: CronJob;
  status: CronRunStatus;
  startedAt: Date;
  finishedAt: Date;
  summary: Record<string, unknown>;
  errorMessage?: string | null;
}

export async function logCronRun(params: LogCronRunParams): Promise<void> {
  try {
    await recordCronRun(params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("cron_run_log_failed", { job: params.job, error: message });
  }
}

export interface BeginCronRunParams {
  job: CronJob;
  startedAt: Date;
}

/**
 * Insert a placeholder `cron_runs` row with `status: 'running'`. The
 * returned id is used by `runIngest` / `runClassify` / `runBroadcast`
 * to stamp child rows (`articles.ingested_in_run`, etc.) so the admin
 * UI can later answer "what did THIS tick touch?".
 *
 * Returns `null` if the DB write fails — callers should pass that
 * through to the run unchanged; the run simply omits the FK on its
 * writes and the admin detail view degrades to "unknown run". We
 * never want a Supabase hiccup to abort the actual ingest/classify
 * work.
 */
export async function beginCronRun(params: BeginCronRunParams): Promise<string | null> {
  try {
    return await startCronRun(params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("cron_run_begin_failed", { job: params.job, error: message });
    return null;
  }
}

export interface EndCronRunParams {
  /** When null (because `beginCronRun` failed), this is a no-op. */
  id: string | null;
  status: CronRunStatus;
  finishedAt: Date;
  summary: Record<string, unknown>;
  errorMessage?: string | null;
}

/**
 * Flip a `running` row into its terminal status with the final
 * summary. Pairs with `beginCronRun`. Errors are swallowed.
 *
 * If `id` is null (the begin call failed), we fall back to a one-shot
 * `recordCronRun` insert so the tick is still tallied in the monitor —
 * just without the FK. Better partial trace than no trace.
 */
export async function endCronRun(params: EndCronRunParams, job: CronJob, startedAt: Date): Promise<void> {
  if (params.id === null) {
    // Fallback: nothing in `cron_runs` yet, so write the whole row at
    // the end. Same shape as the old `logCronRun` path.
    await logCronRun({
      job,
      status: params.status,
      startedAt,
      finishedAt: params.finishedAt,
      summary: params.summary,
      errorMessage: params.errorMessage,
    });
    return;
  }
  try {
    await finishCronRun({
      id: params.id,
      status: params.status,
      finishedAt: params.finishedAt,
      summary: params.summary,
      errorMessage: params.errorMessage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("cron_run_end_failed", { job, runId: params.id, error: message });
  }
}

/**
 * Maps a classify-cron summary into a `cron_run_status`. Partial = some
 * articles failed or the wall-clock budget was exhausted; ok = all
 * processed cleanly; failed = the handler threw before producing a summary.
 */
export function classifyStatus(summary: {
  failed: number;
  budgetExhausted: boolean;
  processed: number;
}): CronRunStatus {
  if (summary.failed > 0 || summary.budgetExhausted) return "partial";
  return "ok";
}

export function ingestStatus(totals: { failedSources: number; inserted: number }): CronRunStatus {
  if (totals.failedSources > 0) return "partial";
  return "ok";
}

/**
 * Maps a broadcast-cron summary into a `cron_run_status`. Partial = at
 * least one platform had a failed post or formatting skip; ok =
 * everything that was eligible posted cleanly (or there was nothing to
 * post, which is also fine — including out-of-window ticks that bail
 * before doing any work).
 */
export function broadcastStatus(summary: {
  failed: { mastodon: number; bluesky: number; telegram: number };
  skipped: number;
  /** Optional for backward-compat with older callers/tests. */
  skippedWindow?: boolean;
}): CronRunStatus {
  // An out-of-window tick is a clean no-op by design (see
  // lib/broadcast/window.ts), never partial.
  if (summary.skippedWindow) return "ok";
  const totalFailed =
    summary.failed.mastodon + summary.failed.bluesky + summary.failed.telegram;
  if (totalFailed > 0 || summary.skipped > 0) return "partial";
  return "ok";
}
