import { beforeEach, describe, expect, it, vi } from "vitest";
import { runBroadcast } from "@/lib/broadcast/run";
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
      enabled: false,
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
      enabled: true,
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
      enabled: true,
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
      enabled: true,
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
      enabled: true,
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
      enabled: true,
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
});
