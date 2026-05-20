import { describe, expect, it } from "vitest";
import type {
  BroadcastByArticleRow,
  BroadcastListRow,
  BroadcastTotalsRow,
  BroadcastsPerDayRow,
} from "@/db/queries/admin-broadcasts";

/**
 * Shape contracts for the admin broadcasts surface. Same pattern as
 * `admin-metrics-shape.test.ts`: the chart + table + tiles all read
 * specific keys, and these specs lock them in.
 */
describe("admin-broadcasts row shapes", () => {
  it("BroadcastsPerDayRow exposes date + per-platform + total", () => {
    const sample: BroadcastsPerDayRow = {
      date: "2026-05-18",
      mastodon: 3,
      bluesky: 2,
      telegram: 1,
      total: 6,
    };
    expect(sample.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sample.mastodon + sample.bluesky + sample.telegram).toBe(sample.total);
  });

  it("BroadcastTotalsRow carries platform + 7d/30d/all + lastPostedAt", () => {
    const sample: BroadcastTotalsRow = {
      platform: "mastodon",
      allTime: 100,
      last30d: 30,
      last7d: 7,
      lastPostedAt: new Date("2026-05-18T10:00:00Z"),
    };
    // Invariants: shorter windows are bounded by longer ones.
    expect(sample.last7d).toBeLessThanOrEqual(sample.last30d);
    expect(sample.last30d).toBeLessThanOrEqual(sample.allTime);
  });

  it("BroadcastListRow joins article fields + external id", () => {
    const sample: BroadcastListRow = {
      id: "b-1",
      platform: "bluesky",
      postedAt: new Date(),
      externalId: "at://did:plc:abc/app.bsky.feed.post/xyz",
      articleId: "a-1",
      articleTitle: "Title",
      articleUrl: "https://example.com",
      categorySlug: "llm",
      relevanceScore: 0.83,
    };
    expect(sample.articleTitle).toBe("Title");
    expect(sample.platform).toBe("bluesky");
  });

  // Phase 8.J pivoted row: one article, three platform cells. The
  // table column-order depends on these keys staying in the row, and
  // the page treats `cells[platform] === null` as "not posted here"
  // — both are pinned here so neither can silently regress.
  it("BroadcastByArticleRow exposes per-platform cells with optional null", () => {
    const sample: BroadcastByArticleRow = {
      articleId: "a-1",
      articleTitle: "Title",
      articleUrl: "https://example.com",
      categorySlug: "llm",
      relevanceScore: 0.83,
      lastPostedAt: new Date("2026-05-18T10:00:00Z"),
      cells: {
        mastodon: { postedAt: new Date(), externalId: "12345" },
        bluesky: null,
        telegram: { postedAt: new Date(), externalId: null },
      },
    };
    expect(sample.cells.mastodon).not.toBeNull();
    expect(sample.cells.bluesky).toBeNull();
    expect(sample.cells.telegram?.externalId).toBeNull();
  });
});
