import { recordCronRun } from "@/db/queries/cron-runs";
import { createLogger } from "@/lib/logger";
import type { CronJob, CronRunStatus } from "@/db/schema";

/**
 * Persists one cron tick into `cron_runs`. Called at the very end of every
 * `/api/cron/{ingest,classify}` handler, regardless of success or failure.
 *
 * The catch is intentional: a logging failure (e.g. transient DB hiccup)
 * must NEVER tumble the cron tick that already did its real work. We log
 * the error and swallow.
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
