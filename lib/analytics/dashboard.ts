import type { AudienceChannel } from "@/db/schema";
import { getMadridDate } from "@/lib/broadcast/window";

/**
 * Pure helpers behind `/admin/analytics`: range parsing, gap filling and
 * the audience pivot. No DB, no React — unit-tested in
 * `tests/analytics-dashboard.test.ts`.
 */

export const RANGE_OPTIONS = [7, 30, 90] as const;
export type RangeDays = (typeof RANGE_OPTIONS)[number];
export const DEFAULT_RANGE: RangeDays = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseRange(raw: unknown): RangeDays {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  return (RANGE_OPTIONS as readonly number[]).includes(n) ? (n as RangeDays) : DEFAULT_RANGE;
}

export interface RangeBounds {
  from: Date;
  to: Date;
  /** Start of the equally long window right before `from`, for deltas. */
  previousFrom: Date;
}

/** Rolling window ending now: `[now - days, now)`. */
export function rangeBounds(days: number, now: Date): RangeBounds {
  const from = new Date(now.getTime() - days * DAY_MS);
  return { from, to: now, previousFrom: new Date(from.getTime() - days * DAY_MS) };
}

/**
 * Every Europe/Madrid calendar day touched by `[from, to]`, oldest first.
 *
 * The cursor walks noon-UTC instants: noon UTC is 13:00 or 14:00 in
 * Madrid, so it always lands on the same calendar date and a DST switch
 * can never make the walk skip or repeat a day. It starts one day early
 * because `from` late in the UTC evening is already "tomorrow" in Madrid.
 */
export function madridDaysBetween(from: Date, to: Date): string[] {
  const first = getMadridDate(from);
  const last = getMadridDate(to);
  const days: string[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() - 1, 12),
  );
  // Bounded loop: the dashboard never asks for more than a few months.
  for (let i = 0; i < 1000; i++) {
    const day = getMadridDate(cursor);
    if (day > last) break;
    if (day >= first) days.push(day);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export interface DailyPoint {
  day: string;
  pageviews: number;
  visitors: number;
}

/** Continuous series: days without traffic become explicit zeros. */
export function fillDailySeries(
  rows: readonly DailyPoint[],
  days: readonly string[],
): DailyPoint[] {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return days.map((day) => byDay.get(day) ?? { day, pageviews: 0, visitors: 0 });
}

/**
 * Percentage change, rounded. `null` when there is no baseline to
 * compare against (a jump from 0 is not a meaningful percentage).
 */
export function percentDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export const AUDIENCE_CHANNELS: readonly AudienceChannel[] = [
  "telegram",
  "mastodon",
  "bluesky",
  "newsletter",
];

export interface SnapshotPoint {
  snapshotDate: string;
  channel: AudienceChannel;
  followers: number;
}

export interface AudienceChannelSummary {
  channel: AudienceChannel;
  /** Latest known reading, or `null` if the channel was never read. */
  current: number | null;
  /** Change vs the latest reading at or before `today - 7d`. */
  change7d: number | null;
  /** Change vs the latest reading at or before `today - 30d`. */
  change30d: number | null;
}

function latestAtOrBefore(points: readonly SnapshotPoint[], day: string): SnapshotPoint | null {
  let found: SnapshotPoint | null = null;
  for (const p of points) {
    if (p.snapshotDate <= day) found = p;
  }
  return found;
}

/**
 * Per channel: current followers and the change over 7 and 30 days.
 * `snapshots` must be sorted by date ascending (the query does that).
 */
export function summarizeAudience(
  snapshots: readonly SnapshotPoint[],
  now: Date,
): AudienceChannelSummary[] {
  const d7 = getMadridDate(new Date(now.getTime() - 7 * DAY_MS));
  const d30 = getMadridDate(new Date(now.getTime() - 30 * DAY_MS));
  return AUDIENCE_CHANNELS.map((channel) => {
    const points = snapshots.filter((s) => s.channel === channel);
    const latest = points[points.length - 1] ?? null;
    const base7 = latestAtOrBefore(points, d7);
    const base30 = latestAtOrBefore(points, d30);
    return {
      channel,
      current: latest?.followers ?? null,
      change7d: latest && base7 ? latest.followers - base7.followers : null,
      change30d: latest && base30 ? latest.followers - base30.followers : null,
    };
  });
}

export type AudienceChartRow = { date: string } & Partial<Record<AudienceChannel, number>>;

/** One row per snapshot day with a column per channel, for the line chart. */
export function pivotAudience(snapshots: readonly SnapshotPoint[]): AudienceChartRow[] {
  const rows = new Map<string, AudienceChartRow>();
  for (const s of snapshots) {
    const row = rows.get(s.snapshotDate) ?? { date: s.snapshotDate };
    row[s.channel] = s.followers;
    rows.set(s.snapshotDate, row);
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date));
}
