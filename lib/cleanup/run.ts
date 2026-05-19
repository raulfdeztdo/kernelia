import {
  hardDeleteArticlesPublishedBefore,
  hardDeleteOldNonClassifiedArticles,
  type HardDeleteResult,
} from "@/db/queries/articles";
import { createLogger } from "@/lib/logger";

/**
 * Daily maintenance cron (Phase 8.F + 8.I).
 *
 * Two independent retention rules run on every tick:
 *
 *  1. **Recent rejects**: hard-delete `failed`/`hidden` articles older
 *     than `retentionDays` (default 7d), keyed by `ingested_at`.
 *     Catches LLM mis-fires and dedupe losers; gives the operator a
 *     week to audit before they're gone.
 *  2. **Old catalogue**: hard-delete ANY article whose `published_at`
 *     predates `(currentYear - publishedYearRetentionWindow)` Jan 1st
 *     (default window = 2; today's run keeps 2024+). One source ships
 *     decade-old archives via its RSS — this rule keeps that off the
 *     feed and out of the DB without operator babysitting.
 *
 * Both deletions write tombstones into `deleted_urls` so the next
 * ingest tick can't reinsert the same URL. Without that the source
 * feed would just bring everything back the moment we cleaned it up.
 *
 * Production cadence: daily at 04:00 UTC (declared in
 * `.github/workflows/cron.yml`). Out of broadcast / classify hours
 * so the DELETE doesn't race with row updates from other ticks.
 */

const log = createLogger("cleanup");

export const DEFAULT_RETENTION_DAYS = 7;

/**
 * How many full calendar years back to keep. Window = 2 with current
 * year 2026 → cutoff is `2024-01-01`, so we keep 2024, 2025 and the
 * current year (2026). The user explicitly asked for "menos al año
 * actual menos 2" — that wording matches "keep the current year and
 * the previous two".
 */
export const DEFAULT_PUBLISHED_YEAR_RETENTION_WINDOW = 2;

export interface RunCleanupOptions {
  /** Override the default 7-day window. Useful for one-off backfills. */
  retentionDays?: number;
  /**
   * Override the published-year window. `0` keeps only the current year;
   * `Infinity` disables the rule entirely (useful for tests that want
   * to isolate the failed/hidden rule).
   */
  publishedYearRetentionWindow?: number;
  /** Inject `now` for tests so the cutoff is deterministic. */
  now?: Date;
  /** Inject the failed/hidden delete query so tests can swap in a spy. */
  deleter?: (
    cutoff: Date,
    options?: { cronRunId?: string | null },
  ) => Promise<HardDeleteResult>;
  /** Inject the published-year delete query for tests. */
  publishedYearDeleter?: (
    cutoff: Date,
    options?: { cronRunId?: string | null },
  ) => Promise<HardDeleteResult>;
  /** Cron-run id threaded into tombstones for traceability (null in tests). */
  cronRunId?: string | null;
}

export interface CleanupSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  retentionDays: number;
  publishedYearRetentionWindow: number;
  /** UTC ISO of the failed/hidden cutoff — anything ingested before this got hard-deleted. */
  cutoff: string;
  /** UTC ISO of the published-year cutoff (`<year>-01-01T00:00:00Z`). */
  publishedYearCutoff: string;
  /** Rows actually removed by the failed/hidden rule. */
  deleted: number;
  /** Rows actually removed by the published-year rule. */
  deletedPublishedYear: number;
  /** Tombstones written across both rules (sum of `tombstoned` from each). */
  tombstoned: number;
  /** First few ids removed (across both rules), for spot-checking. */
  sample: string[];
}

export async function runCleanup(options: RunCleanupOptions = {}): Promise<CleanupSummary> {
  const startedAt = new Date();
  const retentionDays = options.retentionDays ?? DEFAULT_RETENTION_DAYS;
  const publishedYearRetentionWindow =
    options.publishedYearRetentionWindow ?? DEFAULT_PUBLISHED_YEAR_RETENTION_WINDOW;
  const now = options.now ?? startedAt;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  // UTC year so the cutoff is identical across timezones. When the
  // caller passes `Infinity` (test escape hatch) we'd produce a NaN
  // date, so we fall back to the epoch — the deleter never runs in
  // that branch anyway (we guard with `Number.isFinite` below), so
  // the value is purely decorative in the summary.
  const publishedYearCutoff = Number.isFinite(publishedYearRetentionWindow)
    ? new Date(Date.UTC(now.getUTCFullYear() - publishedYearRetentionWindow, 0, 1))
    : new Date(0);

  const deleter = options.deleter ?? hardDeleteOldNonClassifiedArticles;
  const publishedYearDeleter =
    options.publishedYearDeleter ?? hardDeleteArticlesPublishedBefore;
  const cronRunId = options.cronRunId ?? null;

  log.info("tick_start", {
    retentionDays,
    publishedYearRetentionWindow,
    cutoff: cutoff.toISOString(),
    publishedYearCutoff: publishedYearCutoff.toISOString(),
  });

  // Run both deletes serially: the second one's WHERE could include rows
  // the first one already deleted (a row that's `failed` AND old enough
  // by published_at could match both), but DELETE is idempotent and the
  // tombstone insert is `ON CONFLICT DO NOTHING`, so the worst case is
  // a tiny double-counted ms — no correctness impact. Parallelising
  // would risk lock contention on `deleted_urls` for no measurable win.
  const recent = await deleter(cutoff, { cronRunId });
  // `Infinity` window disables the rule — used by tests to isolate
  // the recent-rejects path without contaminating the cutoff math.
  const publishedYear = Number.isFinite(publishedYearRetentionWindow)
    ? await publishedYearDeleter(publishedYearCutoff, { cronRunId })
    : { deleted: 0, sample: [], tombstoned: 0 };

  const finishedAt = new Date();
  const summary: CleanupSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    retentionDays,
    publishedYearRetentionWindow,
    cutoff: cutoff.toISOString(),
    publishedYearCutoff: publishedYearCutoff.toISOString(),
    deleted: recent.deleted,
    deletedPublishedYear: publishedYear.deleted,
    tombstoned: recent.tombstoned + publishedYear.tombstoned,
    sample: [...recent.sample, ...publishedYear.sample].slice(0, 10),
  };
  log.info("tick_done", { ...summary });
  return summary;
}

/**
 * The cleanup cron only has one failure mode worth flagging: the
 * DELETE threw. A clean run with both deletion counters at zero is the
 * steady-state and must NOT be marked partial.
 */
export function cleanupStatus(_summary: CleanupSummary): "ok" {
  return "ok";
}
