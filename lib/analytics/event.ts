import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import type { AnalyticsEventKind, Locale, NewAnalyticsEvent } from "@/db/schema";

/**
 * Turns one beacon hit from `components/analytics-beacon.tsx` into the row
 * we persist in `analytics_events` — or into `null` when it must be
 * dropped (bot, malformed payload, missing secret).
 *
 * Everything here is pure except for reading `process.env.SESSION_SECRET`
 * as a default, so the whole policy (what we keep, what we throw away)
 * is unit-testable without a DB or a request.
 *
 * Privacy contract — this is what `/privacy` promises, keep them in sync:
 *   - The IP and the User-Agent are read to derive `visitor_hash`,
 *     `device` and the bot verdict, and are then discarded. Neither is
 *     ever returned from this module.
 *   - `visitor_hash` rotates every UTC day (the salt is derived from the
 *     date), so it cannot link a visit today to one tomorrow.
 *   - Only the pathname is stored: query strings can carry search terms.
 */

const MAX_PATH = 300;
const MAX_TARGET = 100;
const MAX_UTM = 100;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Wire shape. Keys are one letter because `sendBeacon` bodies ride on
 * every page load; it is not worth more bytes than that.
 *   e: event kind · p: pathname · r: document.referrer · a: article id
 *   t: CTA id or outbound host · us/um/uc: utm source/medium/campaign
 */
export const beaconPayloadSchema = z.object({
  e: z.enum(["pageview", "outbound", "cta"]),
  p: z.string().min(1).max(2000),
  r: z.string().max(2000).optional(),
  a: z.string().regex(UUID_RE).optional(),
  t: z.string().max(500).optional(),
  us: z.string().max(500).optional(),
  um: z.string().max(500).optional(),
  uc: z.string().max(500).optional(),
});

export type BeaconPayload = z.infer<typeof beaconPayloadSchema>;

/**
 * Crawlers, link-preview fetchers and scripted clients. Most bots never
 * run our JS, so the beacon is already a strong filter; this catches the
 * headless ones that do (Lighthouse, Puppeteer-based previewers…).
 */
const BOT_UA_RE =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|whatsapp|telegram|discord|skype|curl|wget|python|axios|node-fetch|go-http|java\/|okhttp|phantomjs|puppeteer|playwright|selenium/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua || ua.trim().length === 0) return true;
  return BOT_UA_RE.test(ua);
}

export type Device = "mobile" | "tablet" | "desktop";

export function detectDevice(ua: string): Device {
  if (/ipad|tablet|kindle|silk/i.test(ua)) return "tablet";
  // Android tablets omit "Mobile" from the UA; phones include it.
  if (/android/i.test(ua) && !/mobile/i.test(ua)) return "tablet";
  if (/mobi|iphone|ipod|android|windows phone/i.test(ua)) return "mobile";
  return "desktop";
}

/**
 * Keeps only the pathname: strips query and fragment, forces a leading
 * slash and caps the length. Returns `null` for anything that isn't a
 * same-origin path (e.g. a full URL smuggled in by a hand-made request).
 */
export function normalizePath(raw: string): string | null {
  const cut = raw.split(/[?#]/)[0] ?? "";
  if (!cut.startsWith("/") || cut.startsWith("//")) return null;
  return cut.slice(0, MAX_PATH);
}

/** `/en` and `/en/...` are English; everything else is the default locale. */
export function localeFromPath(path: string): Locale {
  return path === "/en" || path.startsWith("/en/") ? "en" : "es";
}

/**
 * Host of the referrer, lower-cased and without `www.`. Returns `null`
 * for empty/invalid referrers and for our own host (internal navigation
 * is not a traffic source).
 */
export function referrerHost(referrer: string | undefined, ownHost: string): string | null {
  if (!referrer) return null;
  let host: string;
  try {
    host = new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
  const clean = host.replace(/^www\./, "");
  const own = ownHost.toLowerCase().replace(/^www\./, "");
  if (!clean || clean === own) return null;
  return clean.slice(0, MAX_TARGET);
}

function cleanShort(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed.slice(0, max) : null;
}

/** `YYYY-MM-DD` in UTC — the rotation boundary of the visitor salt. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Truncated sha256 over (daily salt ‖ ip ‖ ua). 16 hex chars = 64 bits:
 * plenty to count distinct visitors per day, too short to be worth
 * brute-forcing back to an IP even if the salt leaked.
 */
export function visitorHash(params: {
  secret: string;
  day: string;
  ip: string;
  userAgent: string;
}): string {
  const salt = createHmac("sha256", params.secret)
    .update(`kernelia-analytics:${params.day}`)
    .digest("hex");
  return createHash("sha256")
    .update(`${salt}|${params.ip}|${params.userAgent}`)
    .digest("hex")
    .slice(0, 16);
}

export interface BuildEventParams {
  payload: unknown;
  ip: string;
  userAgent: string | null;
  country: string | null;
  /** Our public host, to tell internal referrers apart. */
  ownHost: string;
  now?: Date;
  secret?: string | undefined;
}

export type BuildEventResult =
  | { ok: true; row: NewAnalyticsEvent }
  | { ok: false; reason: "bot" | "invalid" | "no_secret" };

export function buildAnalyticsEvent(params: BuildEventParams): BuildEventResult {
  const secret = params.secret ?? process.env.SESSION_SECRET;
  if (!secret) return { ok: false, reason: "no_secret" };

  const ua = params.userAgent ?? "";
  if (isBotUserAgent(ua)) return { ok: false, reason: "bot" };

  const parsed = beaconPayloadSchema.safeParse(params.payload);
  if (!parsed.success) return { ok: false, reason: "invalid" };
  const p = parsed.data;

  const path = normalizePath(p.p);
  if (!path) return { ok: false, reason: "invalid" };

  const event: AnalyticsEventKind = p.e;
  // CTA and outbound events are meaningless without a target.
  const target = cleanShort(p.t, MAX_TARGET);
  if (event !== "pageview" && !target) return { ok: false, reason: "invalid" };

  const now = params.now ?? new Date();
  const country =
    params.country && /^[A-Z]{2}$/i.test(params.country) ? params.country.toUpperCase() : null;

  return {
    ok: true,
    row: {
      occurredAt: now,
      event,
      path,
      locale: localeFromPath(path),
      articleId: p.a ?? null,
      target: event === "pageview" ? null : target,
      // Referrer and UTM describe how the visit STARTED, so they only
      // make sense on pageviews; a click event would double-count them.
      referrerHost: event === "pageview" ? referrerHost(p.r, params.ownHost) : null,
      utmSource: event === "pageview" ? cleanShort(p.us, MAX_UTM) : null,
      utmMedium: event === "pageview" ? cleanShort(p.um, MAX_UTM) : null,
      utmCampaign: event === "pageview" ? cleanShort(p.uc, MAX_UTM) : null,
      country,
      device: detectDevice(ua),
      visitorHash: visitorHash({ secret, day: utcDay(now), ip: params.ip, userAgent: ua }),
    },
  };
}
