import { hardDeleteOldNonClassifiedArticles } from "@/db/queries/articles";
import { createLogger } from "@/lib/logger";

/**
 * Daily maintenance cron (Phase 8.F).
 *
 * Hard-deletes articles older than the retention window whose status
 * is `failed` (LLM rejected outright) or `hidden` (the orchestrator
 * marked them as `non_ai`, `dup_of:*`, or `dup_replaced_by:*`). The
 * row's `classification_error` tag carries the specific reason, but
 * the cleanup query doesn't need to inspect it — by the time a row
 * has sat in `hidden` for >7 days, an operator who wanted to
 * un-hide it has had plenty of time to do so via /admin/articles.
 *
 * The 7-day window is short enough to keep the table small but long
 * enough that:
 *   - we still have a full week of mis-fires to QA the LLM prompt
 *     and adjust the `is_ai_related` rules,
 *   - a duplicate cluster that loses its winner stays visible for
 *     long enough to debug the dedupe heuristic.
 *
 * Production cadence: daily at 04:00 UTC (declared in
 * `.github/workflows/cron.yml`). Out of broadcast / classify hours
 * so the DELETE doesn't race with row updates from other ticks.
 */

const log = createLogger("cleanup");

export const DEFAULT_RETENTION_DAYS = 7;

export interface RunCleanupOptions {
  /** Override the default 7-day window. Useful for one-off backfills. */
  retentionDays?: number;
  /** Inject `now` for tests so the cutoff is deterministic. */
  now?: Date;
  /** Inject the delete query so tests can swap in a spy. */
  deleter?: (cutoff: Date) => Promise<{ deleted: number; sample: string[] }>;
}

export interface CleanupSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  retentionDays: number;
  /** UTC ISO of the cutoff timestamp — anything ingested before this got hard-deleted. */
  cutoff: string;
  /** Rows actually removed by this tick. Zero on a steady-state run. */
  deleted: number;
  /** First few ids removed, for spot-checking from the admin monitor. */
  sample: string[];
}

export async function runCleanup(options: RunCleanupOptions = {}): Promise<CleanupSummary> {
  const startedAt = new Date();
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const now = options.now ?? startedAt;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const deleter = options.deleter ?? hardDeleteOldNonClassifiedArticles;

  log.info("tick_start", { retentionDays, cutoff: cutoff.toISOString() });

  const { deleted, sample } = await deleter(cutoff);

  const finishedAt = new Date();
  const summary: CleanupSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    retentionDays,
    cutoff: cutoff.toISOString(),
    deleted,
    sample,
  };
  log.info("tick_done", { ...summary });
  return summary;
}

/**
 * The cleanup cron only has one failure mode worth flagging: the
 * DELETE threw. A clean run with `deleted: 0` is the steady-state
 * (no rows old enough to nuke) and must NOT be marked partial.
 */
export function cleanupStatus(_summary: CleanupSummary): "ok" {
  return "ok";
}
