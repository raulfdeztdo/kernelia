import { beforeEach, describe, expect, it, vi } from "vitest";
import { newsletterStatus, runNewsletter } from "@/lib/newsletter/run";
import type { ActiveSubscriber } from "@/db/queries/newsletter";
import type { DigestArticle } from "@/lib/newsletter/digest";

/**
 * Run-loop contract. We stub the DB / Resend layer and assert the
 * orchestration shape — budget exhaustion, locale-aware digest dispatch,
 * skip-on-empty, partial-failure tally.
 */

function buildSub(id: string, locale: "es" | "en"): ActiveSubscriber {
  return {
    id,
    email: `${id}@example.com`,
    locale,
    unsubscribeToken: `tok-${id}`,
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

  beforeEach(() => {
    send = vi.fn().mockResolvedValue({ id: "resend-id" });
    sleep = vi.fn().mockResolvedValue(undefined);
  });

  it("happy path: sends to every subscriber whose locale has articles", async () => {
    const summary = await runNewsletter({
      listSubscribers: async () => [buildSub("a", "es"), buildSub("b", "en")],
      fetchDigest: async (locale) =>
        locale === "es" ? [buildArticle("es-1")] : [buildArticle("en-1")],
      send,
      sleep,
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
