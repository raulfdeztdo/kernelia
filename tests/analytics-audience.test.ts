import { describe, expect, it } from "vitest";
import { fetchAudienceCounts, toSnapshotRows } from "@/lib/analytics/audience";
import { runAnalyticsMaintenance } from "@/lib/analytics/maintenance";

describe("fetchAudienceCounts", () => {
  it("isolates failures: a throwing channel becomes null, the rest survive", async () => {
    const counts = await fetchAudienceCounts({
      telegram: async () => 3,
      mastodon: async () => {
        throw new Error("timeout");
      },
      bluesky: async () => null,
      newsletter: async () => 2,
    });
    expect(counts).toEqual({ telegram: 3, mastodon: null, bluesky: null, newsletter: 2 });
  });
});

describe("toSnapshotRows", () => {
  it("skips channels without a reading", () => {
    expect(
      toSnapshotRows({ telegram: 3, mastodon: null, bluesky: 0, newsletter: null }, "2026-09-25"),
    ).toEqual([
      { snapshotDate: "2026-09-25", channel: "telegram", followers: 3 },
      { snapshotDate: "2026-09-25", channel: "bluesky", followers: 0 },
    ]);
  });
});

describe("runAnalyticsMaintenance", () => {
  const now = new Date("2026-09-25T04:00:00Z");

  it("deletes events older than 400 days and records the snapshot", async () => {
    let cutoff: Date | null = null;
    const summary = await runAnalyticsMaintenance({
      now,
      deleteBefore: async (before) => {
        cutoff = before;
        return 4;
      },
      snapshot: async () => ({ telegram: 2, mastodon: 1, bluesky: 1, newsletter: 2 }),
    });
    expect(cutoff).toEqual(new Date("2025-08-21T04:00:00.000Z"));
    expect(summary).toEqual({
      eventsDeleted: 4,
      audience: { telegram: 2, mastodon: 1, bluesky: 1, newsletter: 2 },
      errors: [],
    });
  });

  it("never throws: failures are reported in the summary", async () => {
    const summary = await runAnalyticsMaintenance({
      now,
      deleteBefore: async () => {
        throw new Error("db down");
      },
      snapshot: async () => {
        throw new Error("api down");
      },
    });
    expect(summary).toEqual({
      eventsDeleted: null,
      audience: null,
      errors: ["retention: db down", "audience: api down"],
    });
  });
});
