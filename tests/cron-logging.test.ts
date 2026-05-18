import { describe, expect, it } from "vitest";
import { broadcastStatus, classifyStatus, ingestStatus } from "@/lib/cron-logging";

describe("classifyStatus", () => {
  it("returns 'ok' when every article processed cleanly", () => {
    expect(classifyStatus({ processed: 8, failed: 0, budgetExhausted: false })).toBe("ok");
  });

  it("returns 'partial' when at least one article failed", () => {
    expect(classifyStatus({ processed: 8, failed: 1, budgetExhausted: false })).toBe("partial");
  });

  it("returns 'partial' when the wall-clock budget was exhausted, even with zero failures", () => {
    // Pre-budget, a tick that ran out of time looked identical to a clean
    // tick in the logs. Flagging it as `partial` lets the operator spot
    // sustained budget exhaustion (indicates Cerebras is slow / overloaded).
    expect(classifyStatus({ processed: 4, failed: 0, budgetExhausted: true })).toBe("partial");
  });
});

describe("ingestStatus", () => {
  it("returns 'ok' when all sources fetched", () => {
    expect(ingestStatus({ failedSources: 0, inserted: 5 })).toBe("ok");
  });

  it("returns 'partial' when at least one source failed", () => {
    expect(ingestStatus({ failedSources: 1, inserted: 5 })).toBe("partial");
  });

  it("returns 'partial' even if zero articles inserted (e.g. all dedup'd) as long as some source failed", () => {
    expect(ingestStatus({ failedSources: 1, inserted: 0 })).toBe("partial");
  });

  it("returns 'ok' when zero inserts but every source succeeded (steady state)", () => {
    expect(ingestStatus({ failedSources: 0, inserted: 0 })).toBe("ok");
  });
});

describe("broadcastStatus", () => {
  it("returns 'ok' when every platform posted cleanly and nothing was skipped", () => {
    expect(
      broadcastStatus({ failed: { mastodon: 0, bluesky: 0, telegram: 0 }, skipped: 0 }),
    ).toBe("ok");
  });

  it("returns 'ok' on an empty-but-clean tick (no eligible articles)", () => {
    // The most common steady-state run: nothing new to broadcast. Must NOT
    // be flagged partial — that would create noise in the admin cron view.
    expect(
      broadcastStatus({ failed: { mastodon: 0, bluesky: 0, telegram: 0 }, skipped: 0 }),
    ).toBe("ok");
  });

  it("returns 'partial' when any single platform failed", () => {
    expect(
      broadcastStatus({ failed: { mastodon: 1, bluesky: 0, telegram: 0 }, skipped: 0 }),
    ).toBe("partial");
    expect(
      broadcastStatus({ failed: { mastodon: 0, bluesky: 3, telegram: 0 }, skipped: 0 }),
    ).toBe("partial");
  });

  it("returns 'partial' when articles were skipped (eg. titleEs missing)", () => {
    expect(
      broadcastStatus({ failed: { mastodon: 0, bluesky: 0, telegram: 0 }, skipped: 1 }),
    ).toBe("partial");
  });
});
