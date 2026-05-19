import { beforeEach, describe, expect, it, vi } from "vitest";
import { newsletterStatus, runNewsletter } from "@/lib/newsletter/run";
import type { ActiveSubscriber } from "@/db/queries/newsletter";
import type { DigestArticle } from "@/lib/newsletter/digest";

/**
 * Run-loop contract. We stub the DB / Resend layer and assert the
 * orchestration shape — budget exhaustion, locale-aware digest dispatch,
 * skip-on-empty, partial-failure tally.
 */

function buildSub(
  id: string,
  locale: "es" | "en",
  preferredCategories: string[] = [],
): ActiveSubscriber {
  return {
    id,
    email: `${id}@example.com`,
    locale,
    unsubscribeToken: `tok-${id}`,
    preferredCategories,
  };
}

function buildArticle(id: string): DigestArticle {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Article ${id}`,
    summary: null,
    sourceName: "Test",
    categorySlug: "llm",
    relevanceScore: 0.9,
    imageUrl: null,
    ingestedAt: new Date(),
  };
}

describe("runNewsletter", () => {
  let send: ReturnType<typeof vi.fn>;
  let sleep: ReturnType<typeof vi.fn>;
  let recordSend: ReturnType<typeof vi.fn>;
  let attachResendId: ReturnType<typeof vi.fn>;
  let deleteSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    send = vi.fn().mockResolvedValue({ id: "resend-id" });
    sleep = vi.fn().mockResolvedValue(undefined);
    // Phase 8.E injectables: production hits the DB, tests just
    // hand back a stable id so the loop can render the pixel URL.
    let counter = 0;
    recordSend = vi.fn(async () => `send-${++counter}`);
    attachResendId = vi.fn(async () => {});
    deleteSend = vi.fn(async () => {});
  });

  it("happy path: sends to every subscriber whose locale has articles", async () => {
    const summary = await runNewsletter({
      listSubscribers: async () => [buildSub("a", "es"), buildSub("b", "en")],
      fetchDigest: async (locale) =>
        locale === "es" ? [buildArticle("es-1")] : [buildArticle("en-1")],
      send,
      sleep,
      recordSend,
      attachResendId,
      deleteSend,
      maxWallTimeMs: 60_000,
    });
    expect(summary.attempted).toBe(2);
    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.skippedNoArticles).toBe(0);
    expect(summary.budgetExhausted).toBe(0);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("skips subscribers whose locale has zero articles", async () => {
    const summary = await runNewsletter({
      listSubscribers: async () => [buildSub("a", "es"), buildSub("b", "en")],
      fetchDigest: async (locale) => (locale === "es" ? [buildArticle("es-1")] : []),
      send,
      sleep,
      recordSend,
      attachResendId,
      deleteSend,
      maxWallTimeMs: 60_000,
    });
    expect(summary.sent).toBe(1);
    expect(summary.skippedNoArticles).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("tallies failures without aborting the rest of the loop", async () => {
    send
      .mockResolvedValueOnce({ id: "ok-1" })
      .mockRejectedValueOnce(new Error("Resend 500"))
      .mockResolvedValueOnce({ id: "ok-2" });
    const summary = await runNewsletter({
      listSubscribers: async () => [
        buildSub("a", "es"),
        buildSub("b", "es"),
        buildSub("c", "es"),
      ],
      fetchDigest: async () => [buildArticle("x")],
      send,
      sleep,
      recordSend,
      attachResendId,
      deleteSend,
      maxWallTimeMs: 60_000,
    });
    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(1);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("stops pulling new subscribers once the budget elapses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-18T10:00:00Z"));
    try {
      const summary = await runNewsletter({
        listSubscribers: async () => [
          buildSub("a", "es"),
          buildSub("b", "es"),
          buildSub("c", "es"),
        ],
        fetchDigest: async () => [buildArticle("x")],
        send: vi.fn().mockResolvedValue({ id: "ok" }),
        // The wall-clock check at the top of each iteration reads
        // `Date.now()`. We bump fake time past the budget after the first
        // send so iterations 2 and 3 bail.
        sleep: vi.fn().mockImplementation(async () => {
          vi.advanceTimersByTime(100_000);
        }),
        recordSend,
        attachResendId,
        deleteSend,
        maxWallTimeMs: 50_000,
      });
      // First iteration always runs (budget check is at the top). Iterations
      // 2 and 3 see the elapsed budget and contribute to budgetExhausted.
      expect(summary.attempted).toBe(1);
      expect(summary.sent).toBe(1);
      expect(summary.budgetExhausted).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("records a newsletter_sends row and attaches the Resend id on the happy path (Phase 8.E)", async () => {
    await runNewsletter({
      listSubscribers: async () => [buildSub("a", "es")],
      fetchDigest: async () => [buildArticle("x")],
      send,
      sleep,
      recordSend,
      attachResendId,
      deleteSend,
      cronRunId: "run-42",
      maxWallTimeMs: 60_000,
    });
    expect(recordSend).toHaveBeenCalledWith({ subscriberId: "a", cronRunId: "run-42" });
    // The send fn should receive a tracking URL that contains the
    // sendId returned by recordSend.
    expect(send).toHaveBeenCalledTimes(1);
    const sendCall = send.mock.calls[0]?.[0] as { trackingPixelUrl?: string };
    expect(sendCall).toBeDefined();
    expect(sendCall.trackingPixelUrl).toMatch(/\/api\/track\/open\?id=send-1$/);
    // And attachResendId binds the Resend id to the same row.
    expect(attachResendId).toHaveBeenCalledWith("send-1", "resend-id");
    expect(deleteSend).not.toHaveBeenCalled();
  });

  it("rolls back the pre-created send row when Resend rejects the email", async () => {
    send.mockReset();
    send.mockRejectedValueOnce(new Error("Resend 422"));
    await runNewsletter({
      listSubscribers: async () => [buildSub("a", "es")],
      fetchDigest: async () => [buildArticle("x")],
      send,
      sleep,
      recordSend,
      attachResendId,
      deleteSend,
      maxWallTimeMs: 60_000,
    });
    // Row was created BEFORE the send attempt...
    expect(recordSend).toHaveBeenCalledTimes(1);
    // ...and then deleted because the send threw — no orphaned
    // "send" rows that the admin UI would over-count.
    expect(deleteSend).toHaveBeenCalledWith("send-1");
    expect(attachResendId).not.toHaveBeenCalled();
  });

  it("Phase 8.H: passes each subscriber's preferredCategories to fetchDigest and caches by (locale, slugs)", async () => {
    // Two subscribers in the same locale, one filtering by ["llm"], one
    // by ["agents"], plus a third with no preference. Expect 3 distinct
    // digest fetches. A fourth subscriber sharing slug set with #1 must
    // hit the cache — no extra fetch.
    const fetchDigest = vi.fn(async () => [buildArticle("x")]);
    await runNewsletter({
      listSubscribers: async () => [
        buildSub("a", "es", ["llm"]),
        buildSub("b", "es", ["agents"]),
        buildSub("c", "es", []),
        buildSub("d", "es", ["llm"]),
      ],
      fetchDigest,
      send,
      sleep,
      recordSend,
      attachResendId,
      deleteSend,
      maxWallTimeMs: 60_000,
    });

    // The pre-warm fetches "all" for es + en, then the loop resolves
    // the two custom buckets on demand. The second "llm" subscriber
    // hits the cache → no extra call.
    //
    // Expected unique (locale, key) tuples:
    //   ("es", "<all>"), ("en", "<all>"), ("es", "llm"), ("es", "agents")
    // = 4 fetchDigest calls total.
    expect(fetchDigest).toHaveBeenCalledTimes(4);

    const allSlugArgs = fetchDigest.mock.calls.map(
      (c: unknown[]) => c[2] as readonly string[],
    );
    const sortedSets = allSlugArgs.map((s) => [...s].toSorted().join(","));
    expect(sortedSets).toContain("");
    expect(sortedSets).toContain("llm");
    expect(sortedSets).toContain("agents");
  });

  it("sends without tracking when the pre-create row insert fails (best-effort degradation)", async () => {
    recordSend.mockRejectedValueOnce(new Error("DB down"));
    await runNewsletter({
      listSubscribers: async () => [buildSub("a", "es")],
      fetchDigest: async () => [buildArticle("x")],
      send,
      sleep,
      recordSend,
      attachResendId,
      deleteSend,
      maxWallTimeMs: 60_000,
    });
    // The email still went out, just without the pixel URL.
    expect(send).toHaveBeenCalledTimes(1);
    const sendCall = send.mock.calls[0]?.[0] as { trackingPixelUrl?: string };
    expect(sendCall).toBeDefined();
    expect(sendCall.trackingPixelUrl).toBeUndefined();
    // Nothing to attach or delete because the row never existed.
    expect(attachResendId).not.toHaveBeenCalled();
    expect(deleteSend).not.toHaveBeenCalled();
  });
});

describe("newsletterStatus", () => {
  it("ok when everything went out cleanly", () => {
    expect(
      newsletterStatus({
        attempted: 5,
        sent: 5,
        failed: 0,
        skippedNoArticles: 0,
        budgetExhausted: 0,
        digestCounts: { es: 10, en: 10 },
      }),
    ).toBe("ok");
  });

  it("partial when any send failed", () => {
    expect(
      newsletterStatus({
        attempted: 5,
        sent: 4,
        failed: 1,
        skippedNoArticles: 0,
        budgetExhausted: 0,
        digestCounts: { es: 10, en: 10 },
      }),
    ).toBe("partial");
  });

  it("partial when the budget cut off pending subscribers", () => {
    expect(
      newsletterStatus({
        attempted: 3,
        sent: 3,
        failed: 0,
        skippedNoArticles: 0,
        budgetExhausted: 7,
        digestCounts: { es: 10, en: 10 },
      }),
    ).toBe("partial");
  });

  it("partial when nothing was sent because all locales were empty", () => {
    expect(
      newsletterStatus({
        attempted: 2,
        sent: 0,
        failed: 0,
        skippedNoArticles: 2,
        budgetExhausted: 0,
        digestCounts: { es: 0, en: 0 },
      }),
    ).toBe("partial");
  });

  it("ok when the list was empty (nothing to do is a clean tick)", () => {
    expect(
      newsletterStatus({
        attempted: 0,
        sent: 0,
        failed: 0,
        skippedNoArticles: 0,
        budgetExhausted: 0,
        digestCounts: { es: 0, en: 0 },
      }),
    ).toBe("ok");
  });
});
