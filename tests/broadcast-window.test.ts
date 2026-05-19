import { describe, expect, it } from "vitest";
import {
  BROADCAST_LOCAL_HOURS,
  getMadridHour,
  isWithinBroadcastWindow,
} from "@/lib/broadcast/window";

/**
 * Contract tests for the publishing-window predicate. We pin UTC
 * instants and assert the predicate against the corresponding
 * Europe/Madrid local hour. Covers both CET (winter, UTC+1) and CEST
 * (summer, UTC+2) so the DST handling is verified.
 *
 * Reference DST in EU: spring forward last Sunday of March, fall back
 * last Sunday of October. 2026 transitions:
 *   - CET → CEST: 2026-03-29 at 01:00 UTC
 *   - CEST → CET: 2026-10-25 at 01:00 UTC
 */

describe("BROADCAST_LOCAL_HOURS", () => {
  it("contains the 14 expected publishing hours", () => {
    expect(BROADCAST_LOCAL_HOURS.size).toBe(14);
    // Morning block (excludes 14, 15 — the siesta gap).
    for (const h of [8, 9, 10, 11, 12, 13]) {
      expect(BROADCAST_LOCAL_HOURS.has(h)).toBe(true);
    }
    expect(BROADCAST_LOCAL_HOURS.has(14)).toBe(false);
    expect(BROADCAST_LOCAL_HOURS.has(15)).toBe(false);
    // Afternoon/evening block.
    for (const h of [16, 17, 18, 19, 20, 21, 22, 23]) {
      expect(BROADCAST_LOCAL_HOURS.has(h)).toBe(true);
    }
  });
});

describe("getMadridHour", () => {
  it("returns CEST hour (UTC+2) in summer", () => {
    // 2026-05-19T10:30:00Z → 12:30 Europe/Madrid
    expect(getMadridHour(new Date("2026-05-19T10:30:00Z"))).toBe(12);
  });

  it("returns CET hour (UTC+1) in winter", () => {
    // 2026-01-15T10:30:00Z → 11:30 Europe/Madrid
    expect(getMadridHour(new Date("2026-01-15T10:30:00Z"))).toBe(11);
  });

  it("handles the spring-forward edge cleanly", () => {
    // Just after the spring-forward (CEST in effect):
    // 2026-03-29T02:30:00Z → 04:30 local (already CEST).
    expect(getMadridHour(new Date("2026-03-29T02:30:00Z"))).toBe(4);
  });

  it("handles the fall-back edge cleanly", () => {
    // Just after fall-back (CET in effect):
    // 2026-10-25T02:30:00Z → 03:30 local (already CET).
    expect(getMadridHour(new Date("2026-10-25T02:30:00Z"))).toBe(3);
  });
});

describe("isWithinBroadcastWindow", () => {
  // Each case picks a UTC instant whose Madrid-local hour is the one
  // we want to assert. The cron emits one tick per hour at :30 UTC, so
  // we use :30 UTC instants throughout for realism.
  const cases: ReadonlyArray<{ utc: string; madridHour: number; expected: boolean }> = [
    // Summer (CEST, UTC+2) — full sweep across the day.
    { utc: "2026-05-19T06:30:00Z", madridHour: 8, expected: true }, // morning start
    { utc: "2026-05-19T07:30:00Z", madridHour: 9, expected: true },
    { utc: "2026-05-19T11:30:00Z", madridHour: 13, expected: true }, // last morning
    { utc: "2026-05-19T12:30:00Z", madridHour: 14, expected: false }, // siesta start
    { utc: "2026-05-19T13:30:00Z", madridHour: 15, expected: false }, // siesta end
    { utc: "2026-05-19T14:30:00Z", madridHour: 16, expected: true }, // afternoon resume
    { utc: "2026-05-19T21:30:00Z", madridHour: 23, expected: true }, // night cap
    { utc: "2026-05-19T22:30:00Z", madridHour: 0, expected: false }, // post-midnight
    { utc: "2026-05-19T03:30:00Z", madridHour: 5, expected: false }, // pre-dawn
    // Winter (CET, UTC+1) — confirms DST shift is honoured.
    { utc: "2026-01-15T07:30:00Z", madridHour: 8, expected: true }, // morning start (winter)
    { utc: "2026-01-15T13:30:00Z", madridHour: 14, expected: false }, // siesta (winter)
    { utc: "2026-01-15T22:30:00Z", madridHour: 23, expected: true }, // last (winter)
  ];

  for (const { utc, madridHour, expected } of cases) {
    it(`${utc} → Madrid ${madridHour}h → ${expected ? "in" : "OUT"} window`, () => {
      const d = new Date(utc);
      expect(getMadridHour(d)).toBe(madridHour);
      expect(isWithinBroadcastWindow(d)).toBe(expected);
    });
  }
});
