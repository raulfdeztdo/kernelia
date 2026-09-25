import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `runBroadcast` reaches for two DB helpers when the caller does not
 * inject them: the stale-backlog probe and the last-post lookup behind
 * the cadence throttle. Neither has a `db` to talk to in unit tests, so
 * stub the module to inert defaults — "nothing queued, never posted" —
 * and let each spec inject real behaviour where it is the subject.
 *
 * Without this, adding a DB-backed guard to the orchestrator silently
 * breaks every unrelated spec in this file.
 */
vi.mock("@/db/queries/article-broadcasts", () => ({
  countEligibleIgnoringLookback: async () => 0,
  getLastBroadcastAt: async () => null,
  listPendingForBroadcast: async () => [],
  recordBroadcast: async () => true,
}));

import { BROADCAST_PLATFORMS, runBroadcast } from "@/lib/broadcast/run";
import type { BroadcastPlatform } from "@/db/schema";
import type { PendingBroadcastArticle } from "@/db/queries/article-broadcasts";

/**
 * Orchestrator contract. The real DB and HTTP posters are swapped via the
 * injectables so each spec is independent.
 *
 * Important invariants enforced here:
 *  - `BROADCAST_ENABLED=false` short-circuits with no DB reads.
 *  - One platform throwing does NOT poison the others.
 *  - A post is RECORDED only when the platform poster succeeds AND the
 *    DB write reports a fresh insert. Lost-race INSERTs (returns false)
 *    are not counted as `posted`.
 *  - Articles below `minRelevanceScore` never enter the loop (filter
 *    happens DB-side, but the orchestrator-side test asserts the param
 *    is wired through).
 */

function article(id: string, overrides: Partial<PendingBroadcastArticle> = {}): PendingBroadcastArticle {
  return {
    id,
    titleEs: `Title ${id}`,
    summaryEs: `Summary ${id}`,
    url: `https://example.com/${id}`,
    categorySlug: "llm",
    relevanceScore: 0.9,
    ...overrides,
  };
}

interface Capture {
  listPendingCalls: Array<{ platform: BroadcastPlatform; minScore: number; limit: number }>;
  recordCalls: Array<{ articleId: string; platform: BroadcastPlatform; externalId?: string | null }>;
}

function makeCapture(): Capture {
  return { listPendingCalls: [], recordCalls: [] };
}

const noSleep = (_ms: number) => Promise.resolve();

describe("runBroadcast", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("short-circuits when disabled with zeros in every bucket", async () => {
    const capture = makeCapture();
    const summary = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: false,
      respectWindow: false,
      sleep: noSleep,
      listPending: async (p) => {
        capture.listPendingCalls.push({
          platform: p.platform,
          minScore: p.minScore,
          limit: p.limit,
        });
        return [];
      },
      record: async (p) => {
        capture.recordCalls.push(p);
        return true;
      },
    });

    expect(summary.enabled).toBe(false);
    expect(summary.posted).toEqual({ mastodon: 0, bluesky: 0, telegram: 0 });
    expect(summary.failed).toEqual({ mastodon: 0, bluesky: 0, telegram: 0 });
    // No DB reads, no records — proves we bail before doing anything.
    expect(capture.listPendingCalls).toHaveLength(0);
    expect(capture.recordCalls).toHaveLength(0);
  });

  it("posts every pending article on every platform on the happy path", async () => {
    const capture = makeCapture();
    const articles = [article("a1"), article("a2")];

    const summary = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: true,
      respectWindow: false,
      sleep: noSleep,
      listPending: async () => articles,
      record: async (p) => {
        capture.recordCalls.push(p);
        return true;
      },
      platformPosters: {
        mastodon: async (a) => ({ externalId: `mastodon-${a.id}` }),
        bluesky: async (a) => ({ externalId: `bluesky-${a.id}` }),
        telegram: async (a) => ({ externalId: `telegram-${a.id}` }),
      },
    });

    expect(summary.posted).toEqual({ mastodon: 2, bluesky: 2, telegram: 2 });
    expect(summary.failed).toEqual({ mastodon: 0, bluesky: 0, telegram: 0 });
    expect(capture.recordCalls).toHaveLength(6);
    // Each record carries the externalId we computed in the poster.
    const m = capture.recordCalls.find((r) => r.platform === "mastodon" && r.articleId === "a1");
    expect(m?.externalId).toBe("mastodon-a1");
  });

  it("isolates a platform failure — others still succeed", async () => {
    // Mastodon throws on every post; Bluesky + Telegram complete cleanly.
    const summary = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: true,
      respectWindow: false,
      sleep: noSleep,
      listPending: async () => [article("a1"), article("a2")],
      record: async () => true,
      platformPosters: {
        mastodon: async () => {
          throw new Error("503 Service Unavailable");
        },
        bluesky: async (a) => ({ externalId: `bluesky-${a.id}` }),
        telegram: async (a) => ({ externalId: `telegram-${a.id}` }),
      },
    });

    expect(summary.posted.mastodon).toBe(0);
    expect(summary.failed.mastodon).toBe(2);
    // Other platforms unaffected — exactly the behaviour the unique
    // (article, platform) index makes possible.
    expect(summary.posted.bluesky).toBe(2);
    expect(summary.posted.telegram).toBe(2);
  });

  it("doesn't count posts when the DB write reports a lost race", async () => {
    // Simulates: a parallel tick inserted the row first. `record` returns
    // false → we don't increment `posted` (it's not "our" post).
    const summary = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: true,
      respectWindow: false,
      sleep: noSleep,
      listPending: async () => [article("a1")],
      record: async () => false,
      platformPosters: {
        mastodon: async () => ({ externalId: "m-1" }),
        bluesky: async () => ({ externalId: "b-1" }),
        telegram: async () => ({ externalId: "t-1" }),
      },
    });

    expect(summary.posted).toEqual({ mastodon: 0, bluesky: 0, telegram: 0 });
    expect(summary.failed).toEqual({ mastodon: 0, bluesky: 0, telegram: 0 });
  });

  it("wires the configured minScore through to the listPending call", async () => {
    const capture = makeCapture();
    await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: true,
      respectWindow: false,
      minRelevanceScore: 0.85,
      limitPerPlatform: 3,
      sleep: noSleep,
      listPending: async (p) => {
        capture.listPendingCalls.push({
          platform: p.platform,
          minScore: p.minScore,
          limit: p.limit,
        });
        return [];
      },
      record: async () => true,
    });

    // Three platforms, each called once with the override propagated.
    expect(capture.listPendingCalls).toHaveLength(3);
    for (const call of capture.listPendingCalls) {
      expect(call.minScore).toBe(0.85);
      expect(call.limit).toBe(3);
    }
  });

  it("skips an article that somehow has an empty titleEs", async () => {
    // Defensive: the DB query filters NULL titleEs, but if a future bug
    // lets one through we want it counted in `skipped` not as a crash.
    const summary = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: true,
      respectWindow: false,
      sleep: noSleep,
      listPending: async (p) =>
        p.platform === "mastodon" ? [article("bad", { titleEs: "" })] : [],
      record: async () => true,
      platformPosters: {
        mastodon: async () => ({ externalId: "should-not-happen" }),
        bluesky: async () => ({ externalId: "x" }),
        telegram: async () => ({ externalId: "x" }),
      },
    });

    expect(summary.skipped).toBe(1);
    expect(summary.posted.mastodon).toBe(0);
    expect(summary.failed.mastodon).toBe(0);
  });

  it("bails out before any DB read when current local hour is outside the window", async () => {
    // 2026-05-19T01:30:00Z → 03:30 Europe/Madrid (CEST). Outside the
    // 08-13 / 16-23 publishing window: must short-circuit cleanly with
    // `skippedWindow: true` and zero counters everywhere.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T01:30:00Z"));
    try {
      const capture = makeCapture();
      const summary = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
        enabled: true,
        respectWindow: true,
        sleep: noSleep,
        listPending: async (p) => {
          capture.listPendingCalls.push({
            platform: p.platform,
            minScore: p.minScore,
            limit: p.limit,
          });
          return [];
        },
        record: async () => true,
      });
      expect(summary.skippedWindow).toBe(true);
      expect(summary.posted).toEqual({ mastodon: 0, bluesky: 0, telegram: 0 });
      // The cheap check is BEFORE the DB read — proves we did not even
      // touch Supabase for an out-of-window tick.
      expect(capture.listPendingCalls).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs normally during a valid Madrid hour", async () => {
    // 2026-05-19T08:30:00Z → 10:30 Europe/Madrid (CEST). Inside the
    // morning window — we expect the loop to execute and `skippedWindow`
    // to be false.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T08:30:00Z"));
    try {
      const summary = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
        enabled: true,
        respectWindow: true,
        sleep: noSleep,
        listPending: async () => [article("a1")],
        record: async () => true,
        platformPosters: {
          mastodon: async (a) => ({ externalId: `m-${a.id}` }),
          bluesky: async (a) => ({ externalId: `b-${a.id}` }),
          telegram: async (a) => ({ externalId: `t-${a.id}` }),
        },
      });
      expect(summary.skippedWindow).toBe(false);
      expect(summary.posted).toEqual({ mastodon: 1, bluesky: 1, telegram: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("respectWindow:false ignores the clock (manual dispatch path)", async () => {
    // Same out-of-window instant as the first window test, but with
    // `respectWindow: false`. Proves the admin-panel force flag works.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T01:30:00Z"));
    try {
      const summary = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
        enabled: true,
        respectWindow: false,
        sleep: noSleep,
        listPending: async () => [article("a1")],
        record: async () => true,
        platformPosters: {
          mastodon: async (a) => ({ externalId: `m-${a.id}` }),
          bluesky: async (a) => ({ externalId: `b-${a.id}` }),
          telegram: async (a) => ({ externalId: `t-${a.id}` }),
        },
      });
      expect(summary.skippedWindow).toBe(false);
      expect(summary.posted.mastodon).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Regression cover for the Sep-2026 stall: the broadcast cron ran clean
 * for two weeks, returned `posted: 0, failed: 0` every hour, logged
 * `ok` every time, and published nothing — because the classify backlog
 * had aged every candidate past the 3-day lookback. Nothing in the
 * summary could tell that apart from a quiet news day.
 *
 * `staleBacklog` is the discriminator, so these specs pin its three
 * states. See `STALE_BACKLOG_ALERT_THRESHOLD` in lib/broadcast/run.ts.
 */
describe("runBroadcast — stale backlog detection", () => {
  const emptyPending = async () => [];

  it("reports the count when a tick posts nothing but eligible articles exist outside the lookback", async () => {
    let probeCalls = 0;
    const summary = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: true,
      respectWindow: false,
      sleep: noSleep,
      listPending: emptyPending,
      countEligible: async ({ minScore }) => {
        probeCalls++;
        expect(minScore).toBe(0.75);
        return 122;
      },
    });

    expect(summary.staleBacklog).toBe(122);
    // Probed exactly once per tick, not once per platform.
    expect(probeCalls).toBe(1);
  });

  it("reports 0 — not null — on a genuinely quiet tick, so 'quiet' is provable", async () => {
    const summary = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: true,
      respectWindow: false,
      sleep: noSleep,
      listPending: emptyPending,
      countEligible: async () => 0,
    });

    expect(summary.staleBacklog).toBe(0);
  });

  it("skips the probe entirely when the tick published something", async () => {
    let probeCalls = 0;
    const summary = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: true,
      respectWindow: false,
      sleep: noSleep,
      listPending: async (p) => (p.platform === "telegram" ? [article("a1")] : []),
      record: async () => true,
      platformPosters: {
        telegram: async () => ({ externalId: "t-a1" }),
      },
      countEligible: async () => {
        probeCalls++;
        return 99;
      },
    });

    expect(summary.posted.telegram).toBe(1);
    expect(summary.staleBacklog).toBeNull();
    expect(probeCalls).toBe(0);
  });

  it("skips the probe when a platform failed — that tick is already loud", async () => {
    let probeCalls = 0;
    const summary = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: true,
      respectWindow: false,
      sleep: noSleep,
      listPending: async (p) => (p.platform === "telegram" ? [article("a1")] : []),
      platformPosters: {
        telegram: async () => {
          throw new Error("telegram 502");
        },
      },
      countEligible: async () => {
        probeCalls++;
        return 99;
      },
    });

    expect(summary.failed.telegram).toBe(1);
    expect(summary.staleBacklog).toBeNull();
    expect(probeCalls).toBe(0);
  });

  it("never lets a failing probe take down the tick it is diagnosing", async () => {
    const summary = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: true,
      respectWindow: false,
      sleep: noSleep,
      listPending: emptyPending,
      countEligible: async () => {
        throw new Error("supabase timeout");
      },
    });

    expect(summary.staleBacklog).toBeNull();
    expect(summary.posted.telegram).toBe(0);
  });

  it("leaves staleBacklog null on disabled and out-of-window ticks (no DB touched)", async () => {
    let probeCalls = 0;
    const probe = async () => {
      probeCalls++;
      return 5;
    };

    const disabled = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: false,
      respectWindow: false,
      sleep: noSleep,
      listPending: emptyPending,
      countEligible: probe,
    });
    expect(disabled.staleBacklog).toBeNull();

    const outOfWindow = await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: true,
      respectWindow: true,
      // 03:30 Madrid — outside both publishing windows.
      now: () => new Date("2026-05-19T01:30:00.000Z").getTime(),
      sleep: noSleep,
      listPending: emptyPending,
      countEligible: probe,
    });
    expect(outOfWindow.skippedWindow).toBe(true);
    expect(outOfWindow.staleBacklog).toBeNull();

    expect(probeCalls).toBe(0);
  });
});

/**
 * The lookback is the knob that caused the stall, so its resolution
 * order (explicit option > env > default) is worth pinning.
 */
describe("runBroadcast — lookback window", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const FIXED_NOW = new Date("2026-05-19T08:30:00.000Z").getTime();

  async function capturedSince(options: Parameters<typeof runBroadcast>[0] = {}): Promise<Date> {
    let since: Date | undefined;
    await runBroadcast({
      // Generic orchestrator specs exercise all three posters.
      platforms: BROADCAST_PLATFORMS,
      enabled: true,
      respectWindow: false,
      sleep: noSleep,
      now: () => FIXED_NOW,
      countEligible: async () => 0,
      listPending: async (p) => {
        since = p.since;
        return [];
      },
      ...options,
    });
    if (!since) throw new Error("listPending was never called");
    return since;
  }

  it("defaults to 5 days", async () => {
    const since = await capturedSince();
    expect(FIXED_NOW - since.getTime()).toBe(5 * DAY_MS);
  });

  it("honours BROADCAST_LOOKBACK_DAYS", async () => {
    vi.stubEnv("BROADCAST_LOOKBACK_DAYS", "12");
    const since = await capturedSince();
    expect(FIXED_NOW - since.getTime()).toBe(12 * DAY_MS);
    vi.unstubAllEnvs();
  });

  it("falls back to the default on a garbage or out-of-range env value", async () => {
    for (const bad of ["abc", "0", "-3", "9999"]) {
      vi.stubEnv("BROADCAST_LOOKBACK_DAYS", bad);
      const since = await capturedSince();
      expect(FIXED_NOW - since.getTime()).toBe(5 * DAY_MS);
    }
    vi.unstubAllEnvs();
  });

  it("lets an explicit option win over the env", async () => {
    vi.stubEnv("BROADCAST_LOOKBACK_DAYS", "12");
    const since = await capturedSince({ lookbackMs: 2 * DAY_MS });
    expect(FIXED_NOW - since.getTime()).toBe(2 * DAY_MS);
    vi.unstubAllEnvs();
  });
});

/**
 * The "1 article per platform per hour" product rule. It used to be an
 * emergent property of having exactly one hourly cron; with Hepha as
 * the primary scheduler and GitHub Actions as a backup, two ticks can
 * land in the same hour, so the rule is now enforced server-side.
 *
 * Real incident these pin down: 2026-09-21, posts at 11:09 and 11:47.
 */
describe("runBroadcast — minimum interval between posts", () => {
  const NOW = new Date("2026-05-19T08:30:00.000Z").getTime();
  const MIN_35 = 35 * 60 * 1000;
  const MIN_56 = 56 * 60 * 1000;

  function opts(overrides: Parameters<typeof runBroadcast>[0] = {}) {
    return {
      platforms: BROADCAST_PLATFORMS,
      enabled: true,
      respectWindow: false,
      sleep: noSleep,
      now: () => NOW,
      countEligible: async () => 0,
      listPending: async () => [article("a1")],
      record: async () => true,
      platformPosters: {
        mastodon: async () => ({ externalId: "m" }),
        bluesky: async () => ({ externalId: "b" }),
        telegram: async () => ({ externalId: "t" }),
      },
      ...overrides,
    };
  }

  it("skips a platform that posted 35 minutes ago", async () => {
    const summary = await runBroadcast(
      opts({ lastPostedAt: async () => new Date(NOW - MIN_35) }),
    );

    expect(summary.throttled.sort()).toEqual(["bluesky", "mastodon", "telegram"]);
    expect(summary.posted).toEqual({ mastodon: 0, bluesky: 0, telegram: 0 });
  });

  it("publishes when the last post was 56 minutes ago", async () => {
    const summary = await runBroadcast(
      opts({ lastPostedAt: async () => new Date(NOW - MIN_56) }),
    );

    expect(summary.throttled).toEqual([]);
    expect(summary.posted).toEqual({ mastodon: 1, bluesky: 1, telegram: 1 });
  });

  it("publishes on a platform that has never posted", async () => {
    const summary = await runBroadcast(opts({ lastPostedAt: async () => null }));

    expect(summary.throttled).toEqual([]);
    expect(summary.posted.telegram).toBe(1);
  });

  it("throttles each platform independently", async () => {
    // Telegram failed its last two ticks and is an hour behind; the
    // other two are fresh. Only Telegram should publish.
    const summary = await runBroadcast(
      opts({
        lastPostedAt: async (p) =>
          new Date(NOW - (p === "telegram" ? MIN_56 : MIN_35)),
      }),
    );

    expect(summary.throttled.sort()).toEqual(["bluesky", "mastodon"]);
    expect(summary.posted).toEqual({ mastodon: 0, bluesky: 0, telegram: 1 });
  });

  it("applies to force/manual dispatches too — force skips the window, not the cadence", async () => {
    // `respectWindow: false` is what `?force=1` sets. It must not become
    // a licence to double-post ten minutes apart.
    const summary = await runBroadcast(
      opts({
        respectWindow: false,
        lastPostedAt: async () => new Date(NOW - 10 * 60 * 1000),
      }),
    );

    expect(summary.throttled.length).toBe(3);
    expect(summary.posted.telegram).toBe(0);
  });

  it("does not raise a stale-backlog alarm when every platform was throttled", async () => {
    let probeCalls = 0;
    const summary = await runBroadcast(
      opts({
        lastPostedAt: async () => new Date(NOW - MIN_35),
        countEligible: async () => {
          probeCalls++;
          return 99;
        },
      }),
    );

    // Publishing nothing was the correct outcome here, so it must not
    // look like the Sep-2026 stall.
    expect(summary.staleBacklog).toBeNull();
    expect(probeCalls).toBe(0);
  });

  it("minIntervalMs: 0 disables the throttle entirely", async () => {
    const summary = await runBroadcast(
      opts({ minIntervalMs: 0, lastPostedAt: async () => new Date(NOW - 1000) }),
    );

    expect(summary.throttled).toEqual([]);
    expect(summary.posted.telegram).toBe(1);
  });
});

describe("runBroadcast — Phase 9.C platform split", () => {
  it("posts hourly to Mastodon and Bluesky only; Telegram gets the digest", async () => {
    const seen: BroadcastPlatform[] = [];
    const summary = await runBroadcast({
      enabled: true,
      respectWindow: false,
      sleep: noSleep,
      listPending: async (p) => {
        seen.push(p.platform);
        return [article("a1")];
      },
      record: async () => true,
      platformPosters: {
        mastodon: async () => ({ externalId: "m" }),
        bluesky: async () => ({ externalId: "b" }),
        telegram: async () => ({ externalId: "t" }),
      },
    });
    expect(seen.sort()).toEqual(["bluesky", "mastodon"]);
    expect(summary.posted).toEqual({ mastodon: 1, bluesky: 1, telegram: 0 });
  });
});
