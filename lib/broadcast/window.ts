/**
 * Broadcast cadence window.
 *
 * Product rule: we publish ONE article per platform per hour, strictly
 * during waking hours in Spain — `[08:30, 23:30]` local, skipping the
 * lunch-siesta gap (`14:30` and `15:30`). That gives 14 windows/day:
 *
 *   08, 09, 10, 11, 12, 13,        ← morning
 *   16, 17, 18, 19, 20, 21, 22, 23 ← afternoon-evening
 *
 * GitHub Actions cron only understands UTC. We schedule it `30 * * * *`
 * (every hour at :30 UTC, 24 ticks/day) and let the broadcast handler
 * decide whether to actually run by checking the LOCAL clock here. This
 * is the only sane way to honour DST: `Europe/Madrid` swings between
 * UTC+1 and UTC+2 twice a year, so a UTC-only schedule would either
 * publish during siesta or skip evening hours half the year.
 *
 * `Intl.DateTimeFormat` resolves the zone via the IANA database that
 * ships with Node ≥ 18 (Vercel runtime), so this works without
 * additional deps and stays correct through future DST policy changes.
 */

/** Hours of the day, in Europe/Madrid local time, when broadcasts go out. */
export const BROADCAST_LOCAL_HOURS: ReadonlySet<number> = new Set([
  8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23,
]);

export const BROADCAST_TIMEZONE = "Europe/Madrid";

/**
 * Returns the hour-of-day (0-23) in Europe/Madrid for the given instant.
 * Uses `Intl.DateTimeFormat` so DST is handled transparently.
 */
export function getMadridHour(now: Date): number {
  // `hourCycle: "h23"` forces 00-23 regardless of locale defaults.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: BROADCAST_TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const hourPart = parts.find((p) => p.type === "hour");
  if (!hourPart) {
    // Should never happen with the options above; fail loud rather than
    // silently broadcasting at the wrong hour.
    throw new Error("isWithinBroadcastWindow: failed to extract hour from Intl parts");
  }
  return Number.parseInt(hourPart.value, 10);
}

/**
 * `true` when the current local hour is one of the publishing windows.
 * The minute is intentionally ignored — GitHub Actions cron jitter can
 * push a `:30` tick to `:32` or `:35`, and we don't want to skip an
 * entire hour because of that.
 */
export function isWithinBroadcastWindow(now: Date): boolean {
  const hour = getMadridHour(now);
  return BROADCAST_LOCAL_HOURS.has(hour);
}
