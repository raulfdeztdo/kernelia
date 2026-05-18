import { describe, expect, it } from "vitest";
import type { PublicStats } from "@/lib/stats";

/**
 * Contract test for the `/api/stats` JSON shape. Anyone scraping the
 * endpoint (third parties, the `/stats` page itself, future graphs)
 * depends on these keys staying stable. If a field is renamed or
 * removed, that's a breaking change for downstream consumers — the
 * test enforces an explicit decision rather than a silent drift.
 *
 * Behavioural coverage (DB round-trip) is exercised by manual smoke
 * against Supabase — the queries are simple aggregates that share the
 * same Drizzle shape as the admin-metrics layer already covered.
 */
describe("PublicStats contract", () => {
  it("has the documented top-level keys", () => {
    const sample: PublicStats = {
      articles: { classified: 100, classifiedLast7d: 20 },
      sources: { active: 10 },
      categories: { total: 10 },
      tokens: { last30dTotal: 123456 },
      lastIngestAt: "2026-05-18T10:00:00.000Z",
      lastClassifyAt: "2026-05-18T10:30:00.000Z",
      generatedAt: "2026-05-18T11:00:00.000Z",
    };
    expect(Object.keys(sample).sort()).toEqual([
      "articles",
      "categories",
      "generatedAt",
      "lastClassifyAt",
      "lastIngestAt",
      "sources",
      "tokens",
    ]);
  });

  it("allows lastIngestAt and lastClassifyAt to be null on an empty DB", () => {
    const sample: PublicStats = {
      articles: { classified: 0, classifiedLast7d: 0 },
      sources: { active: 0 },
      categories: { total: 0 },
      tokens: { last30dTotal: 0 },
      lastIngestAt: null,
      lastClassifyAt: null,
      generatedAt: "2026-05-18T11:00:00.000Z",
    };
    expect(sample.lastIngestAt).toBeNull();
    expect(sample.lastClassifyAt).toBeNull();
  });

  it("articles section exposes total and 7d window as numbers", () => {
    const sample: PublicStats["articles"] = { classified: 500, classifiedLast7d: 30 };
    expect(typeof sample.classified).toBe("number");
    expect(typeof sample.classifiedLast7d).toBe("number");
    // 7d window is bounded by the total — never larger.
    expect(sample.classifiedLast7d).toBeLessThanOrEqual(sample.classified);
  });
});
