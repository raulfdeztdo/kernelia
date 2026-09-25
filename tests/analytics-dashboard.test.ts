import { describe, expect, it } from "vitest";
import {
  fillDailySeries,
  madridDaysBetween,
  parseRange,
  percentDelta,
  pivotAudience,
  rangeBounds,
  summarizeAudience,
  type SnapshotPoint,
} from "@/lib/analytics/dashboard";

describe("parseRange", () => {
  it("accepts the offered ranges and falls back to 30", () => {
    expect(parseRange("7")).toBe(7);
    expect(parseRange("90")).toBe(90);
    expect(parseRange("365")).toBe(30);
    expect(parseRange(undefined)).toBe(30);
    expect(parseRange(["7"])).toBe(30);
  });
});

describe("rangeBounds", () => {
  it("returns the window and an equally long previous window", () => {
    const now = new Date("2026-09-25T10:00:00Z");
    const b = rangeBounds(7, now);
    expect(b.to).toEqual(now);
    expect(b.from.toISOString()).toBe("2026-09-18T10:00:00.000Z");
    expect(b.previousFrom.toISOString()).toBe("2026-09-11T10:00:00.000Z");
  });
});

describe("madridDaysBetween", () => {
  it("lists every Madrid day, inclusive", () => {
    expect(
      madridDaysBetween(new Date("2026-09-23T10:00:00Z"), new Date("2026-09-25T10:00:00Z")),
    ).toEqual(["2026-09-23", "2026-09-24", "2026-09-25"]);
  });

  it("uses the Madrid date, not the UTC one, at the edges", () => {
    // 22:30Z on the 23rd is already the 24th in Madrid (CEST, UTC+2).
    expect(
      madridDaysBetween(new Date("2026-09-23T22:30:00Z"), new Date("2026-09-24T12:00:00Z")),
    ).toEqual(["2026-09-24"]);
  });

  it("neither skips nor repeats a day across the October DST change", () => {
    const days = madridDaysBetween(
      new Date("2026-10-23T12:00:00Z"),
      new Date("2026-10-27T12:00:00Z"),
    );
    expect(days).toEqual(["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"]);
  });
});

describe("fillDailySeries", () => {
  it("fills missing days with zeros in the given order", () => {
    const out = fillDailySeries(
      [{ day: "2026-09-24", pageviews: 5, visitors: 3 }],
      ["2026-09-23", "2026-09-24"],
    );
    expect(out).toEqual([
      { day: "2026-09-23", pageviews: 0, visitors: 0 },
      { day: "2026-09-24", pageviews: 5, visitors: 3 },
    ]);
  });
});

describe("percentDelta", () => {
  it("computes a rounded percentage and refuses a zero baseline", () => {
    expect(percentDelta(150, 100)).toBe(50);
    expect(percentDelta(50, 100)).toBe(-50);
    expect(percentDelta(10, 0)).toBeNull();
  });
});

describe("summarizeAudience / pivotAudience", () => {
  const snaps: SnapshotPoint[] = [
    { snapshotDate: "2026-08-20", channel: "telegram", followers: 2 },
    { snapshotDate: "2026-09-18", channel: "telegram", followers: 5 },
    { snapshotDate: "2026-09-18", channel: "mastodon", followers: 10 },
    { snapshotDate: "2026-09-25", channel: "telegram", followers: 12 },
    { snapshotDate: "2026-09-25", channel: "mastodon", followers: 9 },
  ];
  const now = new Date("2026-09-25T10:00:00Z");

  it("reports current value and 7d/30d change per channel", () => {
    const byChannel = Object.fromEntries(summarizeAudience(snaps, now).map((s) => [s.channel, s]));
    expect(byChannel.telegram).toMatchObject({ current: 12, change7d: 7, change30d: 10 });
    expect(byChannel.mastodon).toMatchObject({ current: 9, change7d: -1, change30d: null });
    expect(byChannel.bluesky).toMatchObject({ current: null, change7d: null, change30d: null });
  });

  it("pivots snapshots into one row per day", () => {
    expect(pivotAudience(snaps)).toEqual([
      { date: "2026-08-20", telegram: 2 },
      { date: "2026-09-18", telegram: 5, mastodon: 10 },
      { date: "2026-09-25", telegram: 12, mastodon: 9 },
    ]);
  });
});
