import { describe, expect, it } from "vitest";
import { summariseRun } from "@/lib/admin/cron-run-summary";
import type { CronRun } from "@/db/schema";

/**
 * `summariseRun` is the one-liner the `/admin/cron` list renders for
 * every row. The broadcast variant in particular took an `[object
 * Object]` regression because `failed` is a `Record<platform, number>`
 * but the template interpolated it as a scalar. These specs guard the
 * shapes we have in production and the back-compat fallbacks.
 */

function makeRun(job: CronRun["job"], summary: Record<string, unknown>): CronRun {
  return {
    id: "r-1",
    job,
    status: "ok",
    startedAt: new Date(),
    finishedAt: new Date(),
    durationMs: 0,
    summary,
    errorMessage: null,
  } as CronRun;
}

describe("summariseRun · broadcast", () => {
  it("renders failed as the sum across platforms (current shape)", () => {
    const out = summariseRun(
      makeRun("broadcast", {
        posted: { mastodon: 1, bluesky: 1, telegram: 1 },
        failed: { mastodon: 0, bluesky: 0, telegram: 0 },
        skipped: 0,
      }),
    );
    expect(out).toBe("mastodon=1  bluesky=1  telegram=1  failed=0  skipped=0");
    expect(out).not.toContain("[object Object]");
  });

  it("tolerates legacy rows where failed was a scalar", () => {
    // Older `cron_runs` rows (from before runBroadcast bumped `failed`
    // to a Record) shouldn't suddenly render as 0 just because the
    // shape changed under them.
    const out = summariseRun(
      makeRun("broadcast", {
        posted: { mastodon: 2, bluesky: 0, telegram: 0 },
        failed: 3,
        skipped: 1,
      }),
    );
    expect(out).toBe("mastodon=2  bluesky=0  telegram=0  failed=3  skipped=1");
  });

  it("aggregates per-platform failures correctly", () => {
    const out = summariseRun(
      makeRun("broadcast", {
        posted: { mastodon: 2, bluesky: 0, telegram: 1 },
        failed: { mastodon: 1, bluesky: 2, telegram: 0 },
        skipped: 0,
      }),
    );
    expect(out).toContain("failed=3");
  });

  it("short-circuits to the skipped-window message", () => {
    const out = summariseRun(
      makeRun("broadcast", {
        skippedWindow: true,
        posted: { mastodon: 0, bluesky: 0, telegram: 0 },
        failed: { mastodon: 0, bluesky: 0, telegram: 0 },
        skipped: 0,
      }),
    );
    expect(out).toMatch(/skippedWindow=true/);
  });
});
