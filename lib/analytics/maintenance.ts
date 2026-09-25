import { deleteAnalyticsEventsBefore } from "@/db/queries/analytics";
import { createLogger } from "@/lib/logger";
import { recordAudienceSnapshot, type AudienceCounts } from "./audience";

/**
 * Daily analytics housekeeping, piggy-backed on the `cleanup` cron (the
 * one daily job GitHub serves reliably, see `.github/workflows/cron.yml`):
 *
 *   1. Retention — drop events older than `ANALYTICS_RETENTION_DAYS`.
 *      400 days keeps a full year-over-year comparison available.
 *   2. Audience — record today's follower counts per channel.
 *
 * Each step is isolated: analytics trouble must never turn the article
 * cleanup red, so failures are reported in the summary, not thrown.
 */

const log = createLogger("analytics_maintenance");

export const ANALYTICS_RETENTION_DAYS = 400;

export interface AnalyticsMaintenanceSummary {
  eventsDeleted: number | null;
  audience: AudienceCounts | null;
  errors: string[];
}

export interface AnalyticsMaintenanceDeps {
  now?: Date;
  deleteBefore?: (before: Date) => Promise<number>;
  snapshot?: (now: Date) => Promise<AudienceCounts>;
}

export async function runAnalyticsMaintenance(
  deps: AnalyticsMaintenanceDeps = {},
): Promise<AnalyticsMaintenanceSummary> {
  const now = deps.now ?? new Date();
  const deleteBefore = deps.deleteBefore ?? deleteAnalyticsEventsBefore;
  const snapshot = deps.snapshot ?? recordAudienceSnapshot;
  const errors: string[] = [];

  let eventsDeleted: number | null = null;
  try {
    eventsDeleted = await deleteBefore(
      new Date(now.getTime() - ANALYTICS_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`retention: ${message}`);
    log.warn("retention_failed", { reason: message });
  }

  let audience: AudienceCounts | null = null;
  try {
    audience = await snapshot(now);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    errors.push(`audience: ${message}`);
    log.warn("audience_snapshot_failed", { reason: message });
  }

  return { eventsDeleted, audience, errors };
}
