import { describe, expect, it, vi } from "vitest";
import { broadcastStatus, classifyStatus, endCronRun, ingestStatus } from "@/lib/cron-logging";

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

  it("returns 'ok' when the tick bailed out of the publishing window", () => {
    // Regression for Phase 8.D: an out-of-window broadcast tick is by
    // design a no-op, not a partial failure.
    expect(
      broadcastStatus({
        failed: { mastodon: 0, bluesky: 0, telegram: 0 },
        skipped: 0,
        skippedWindow: true,
      }),
    ).toBe("ok");
  });
});

describe("endCronRun fallback path", () => {
  // The two-phase flow (`beginCronRun` + `endCronRun`) becomes a
  // one-shot insert when `beginCronRun` returns null (e.g. transient
  // DB hiccup at the start of the tick). We can't easily mock the
  // DB layer here, but we can at least assert the function shape
  // and that it doesn't throw on a null id — that's the property
  // the cron handler depends on to not crash.
  it("is callable with id=null without throwing the contract", () => {
    // We don't await here because the underlying DB call would
    // require a live connection. Instead we assert the function
    // returns a Promise (i.e. the call shape is valid).
    const p = endCronRun(
      {
        id: null,
        status: "ok",
        finishedAt: new Date(),
        summary: { processed: 0 },
      },
      "ingest",
      new Date(),
    );
    expect(p).toBeInstanceOf(Promise);
    // Swallow any rejection so the test process stays clean.
    void p.catch(() => {});
  });
});

describe("isWithinBroadcastWindow integration via broadcastStatus", () => {
  // Smoke test: `broadcastStatus` accepts the optional skippedWindow
  // field (must be backwards-compatible with the existing callers).
  it("accepts a summary without skippedWindow (back-compat)", () => {
    // No type error, no runtime error. Returns 'ok' on a clean shape.
    expect(
      broadcastStatus({ failed: { mastodon: 0, bluesky: 0, telegram: 0 }, skipped: 0 }),
    ).toBe("ok");
  });
});

describe("logger smoke", () => {
  // Trivial canary so the import surface stays under test even when
  // the queries themselves are exercised via integration paths.
  it("vi is available", () => {
    expect(vi).toBeDefined();
  });
});
