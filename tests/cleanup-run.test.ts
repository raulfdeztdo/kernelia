import { describe, expect, it, vi } from "vitest";
import { DEFAULT_RETENTION_DAYS, cleanupStatus, runCleanup } from "@/lib/cleanup/run";

/**
 * Contract tests for the daily cleanup tick (Phase 8.F). The real
 * DELETE query is swapped via the `deleter` injectable so each spec
 * is independent of Supabase.
 */

describe("runCleanup", () => {
  it("passes a cutoff equal to now - retentionDays to the deleter", async () => {
    const deleter = vi.fn(async (_cutoff: Date) => ({ deleted: 0, sample: [] as string[] }));
    const now = new Date("2026-05-19T04:00:00Z");
    await runCleanup({ now, deleter });
    expect(deleter).toHaveBeenCalledTimes(1);
    const cutoff = deleter.mock.calls[0]?.[0] as Date | undefined;
    expect(cutoff).toBeInstanceOf(Date);
    // Default 7-day window → 2026-05-12T04:00:00Z.
    expect(cutoff?.toISOString()).toBe("2026-05-12T04:00:00.000Z");
  });

  it("honours a custom retentionDays override", async () => {
    const deleter = vi.fn(async (_cutoff: Date) => ({ deleted: 0, sample: [] as string[] }));
    const now = new Date("2026-05-19T04:00:00Z");
    await runCleanup({ now, retentionDays: 30, deleter });
    const cutoff = deleter.mock.calls[0]?.[0] as Date | undefined;
    expect(cutoff?.toISOString()).toBe("2026-04-19T04:00:00.000Z");
  });

  it("propagates deleted count and sample into the summary", async () => {
    const sample = ["a", "b", "c"];
    const deleter = vi.fn(async () => ({ deleted: 42, sample }));
    const summary = await runCleanup({ deleter });
    expect(summary.deleted).toBe(42);
    expect(summary.sample).toEqual(sample);
    expect(summary.retentionDays).toBe(DEFAULT_RETENTION_DAYS);
    // Cutoff is an ISO string in the summary, never a Date.
    expect(typeof summary.cutoff).toBe("string");
    expect(summary.cutoff.endsWith("Z")).toBe(true);
  });

  it("returns a clean summary even when nothing was deletable", async () => {
    const summary = await runCleanup({
      deleter: async () => ({ deleted: 0, sample: [] }),
    });
    expect(summary.deleted).toBe(0);
    expect(summary.sample).toEqual([]);
  });

  it("surfaces DELETE errors to the caller (the route handler maps to status='failed')", async () => {
    // The route handler relies on this contract: when the underlying
    // query throws, runCleanup throws the same error. The handler
    // then writes `status='failed'` to cron_runs via endCronRun.
    const deleter = vi.fn(async () => {
      throw new Error("DB write timeout");
    });
    await expect(runCleanup({ deleter })).rejects.toThrow("DB write timeout");
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
        cutoff: "2026-05-12T04:00:00Z",
        deleted: 0,
        sample: [],
      }),
    ).toBe("ok");
  });
});
