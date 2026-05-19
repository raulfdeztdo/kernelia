import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PUBLISHED_YEAR_RETENTION_WINDOW,
  DEFAULT_RETENTION_DAYS,
  cleanupStatus,
  runCleanup,
} from "@/lib/cleanup/run";
import type { HardDeleteResult } from "@/db/queries/articles";

/**
 * Contract tests for the daily cleanup tick (Phase 8.F + 8.I).
 *
 * The two DELETE queries are swapped via injectables (`deleter`,
 * `publishedYearDeleter`) so each spec is independent of Supabase.
 * Every mocked deleter returns the new `HardDeleteResult` shape
 * (`deleted`, `sample`, `tombstoned`) — older shapes are not allowed.
 */

const emptyResult = (): HardDeleteResult => ({ deleted: 0, sample: [], tombstoned: 0 });

describe("runCleanup", () => {
  it("passes a cutoff equal to now - retentionDays to the failed/hidden deleter", async () => {
    const deleter = vi.fn(async (_cutoff: Date) => emptyResult());
    const publishedYearDeleter = vi.fn(async (_cutoff: Date) => emptyResult());
    const now = new Date("2026-05-19T04:00:00Z");
    await runCleanup({ now, deleter, publishedYearDeleter });
    expect(deleter).toHaveBeenCalledTimes(1);
    const cutoff = deleter.mock.calls[0]?.[0] as Date | undefined;
    expect(cutoff).toBeInstanceOf(Date);
    // Default 7-day window → 2026-05-12T04:00:00Z.
    expect(cutoff?.toISOString()).toBe("2026-05-12T04:00:00.000Z");
  });

  it("honours a custom retentionDays override", async () => {
    const deleter = vi.fn(async (_cutoff: Date) => emptyResult());
    const publishedYearDeleter = vi.fn(async (_cutoff: Date) => emptyResult());
    const now = new Date("2026-05-19T04:00:00Z");
    await runCleanup({ now, retentionDays: 30, deleter, publishedYearDeleter });
    const cutoff = deleter.mock.calls[0]?.[0] as Date | undefined;
    expect(cutoff?.toISOString()).toBe("2026-04-19T04:00:00.000Z");
  });

  it("Phase 8.I: hands a Jan-1 cutoff (currentYear - window) to the published-year deleter", async () => {
    const deleter = vi.fn(async (_cutoff: Date) => emptyResult());
    const publishedYearDeleter = vi.fn(async (_cutoff: Date) => emptyResult());
    const now = new Date("2026-05-19T04:00:00Z");
    await runCleanup({ now, deleter, publishedYearDeleter });
    // Default window = 2 → 2024-01-01T00:00:00Z (keep 2024, 2025, 2026).
    const cutoff = publishedYearDeleter.mock.calls[0]?.[0] as Date | undefined;
    expect(cutoff?.toISOString()).toBe("2024-01-01T00:00:00.000Z");
  });

  it("Phase 8.I: skips the published-year delete when the window is Infinity (test escape hatch)", async () => {
    const deleter = vi.fn(async (_cutoff: Date) => emptyResult());
    const publishedYearDeleter = vi.fn(async (_cutoff: Date) => emptyResult());
    await runCleanup({
      publishedYearRetentionWindow: Infinity,
      deleter,
      publishedYearDeleter,
    });
    expect(deleter).toHaveBeenCalledTimes(1);
    // Crucial: the spy MUST NOT fire when the window is Infinity. Otherwise
    // tests that want to isolate the failed/hidden path would also exercise
    // the published-year code via the injected default.
    expect(publishedYearDeleter).not.toHaveBeenCalled();
  });

  it("aggregates counts and samples from both deleters", async () => {
    const deleter = vi.fn(async () => ({
      deleted: 42,
      sample: ["a", "b", "c"],
      tombstoned: 42,
    }));
    const publishedYearDeleter = vi.fn(async () => ({
      deleted: 7,
      sample: ["x", "y"],
      tombstoned: 7,
    }));
    const summary = await runCleanup({ deleter, publishedYearDeleter });
    expect(summary.deleted).toBe(42);
    expect(summary.deletedPublishedYear).toBe(7);
    expect(summary.tombstoned).toBe(49);
    // Sample interleaves both rules' first-10 ids, capped at 10 overall.
    expect(summary.sample).toEqual(["a", "b", "c", "x", "y"]);
    expect(summary.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    expect(summary.publishedYearRetentionWindow).toBe(
      DEFAULT_PUBLISHED_YEAR_RETENTION_WINDOW,
    );
    expect(summary.cutoff.endsWith("Z")).toBe(true);
    expect(summary.publishedYearCutoff.endsWith("Z")).toBe(true);
  });

  it("returns a clean summary even when nothing was deletable", async () => {
    const summary = await runCleanup({
      deleter: async () => emptyResult(),
      publishedYearDeleter: async () => emptyResult(),
    });
    expect(summary.deleted).toBe(0);
    expect(summary.deletedPublishedYear).toBe(0);
    expect(summary.tombstoned).toBe(0);
    expect(summary.sample).toEqual([]);
  });

  it("surfaces DELETE errors to the caller (the route handler maps to status='failed')", async () => {
    // The route handler relies on this contract: when the underlying
    // query throws, runCleanup throws the same error. The handler
    // then writes `status='failed'` to cron_runs via endCronRun.
    const deleter = vi.fn(async () => {
      throw new Error("DB write timeout");
    });
    const publishedYearDeleter = vi.fn(async () => emptyResult());
    await expect(runCleanup({ deleter, publishedYearDeleter })).rejects.toThrow(
      "DB write timeout",
    );
  });
});

describe("cleanupStatus", () => {
  it("returns 'ok' for any clean cleanup summary (no partial state)", () => {
    // Unlike classify/broadcast/newsletter, the cleanup tick has no
    // partial-success mode: either the DELETE succeeded or the route
    // handler caught it and stamped `failed`. Steady-state runs with
    // `deleted: 0` must still be 'ok' to avoid noise in /admin/cron.
    expect(
      cleanupStatus({
        startedAt: "2026-05-19T04:00:00Z",
        finishedAt: "2026-05-19T04:00:01Z",
        durationMs: 1000,
        retentionDays: 7,
        publishedYearRetentionWindow: 2,
        cutoff: "2026-05-12T04:00:00Z",
        publishedYearCutoff: "2024-01-01T00:00:00Z",
        deleted: 0,
        deletedPublishedYear: 0,
        tombstoned: 0,
        sample: [],
      }),
    ).toBe("ok");
  });
});
