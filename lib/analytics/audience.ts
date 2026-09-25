import {
  hasAudienceSnapshotFor,
  upsertAudienceSnapshots,
  type AudienceSnapshotInput,
} from "@/db/queries/analytics";
import { getNewsletterCounts } from "@/db/queries/newsletter";
import type { AudienceChannel } from "@/db/schema";
import { getMadridDate } from "@/lib/broadcast/window";
import { createLogger } from "@/lib/logger";

/**
 * How big is each channel's audience right now?
 *
 * Reads follower counts from each platform's PUBLIC API (no extra
 * scopes needed on the tokens the broadcaster already has) plus the
 * active newsletter subscribers. Every source is independent and
 * best-effort: a platform that times out or isn't configured yields
 * `null` and simply has no point on the chart that day.
 */

const log = createLogger("analytics_audience");
const TIMEOUT_MS = 5_000;

export type AudienceCounts = Record<AudienceChannel, number | null>;

type FetchFn = typeof fetch;

async function getJson(fetchImpl: FetchFn, url: string): Promise<unknown> {
  const res = await fetchImpl(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export async function fetchTelegramMembers(fetchImpl: FetchFn = fetch): Promise<number | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return null;
  // The URL carries the bot token: never log it, only the outcome.
  const json = (await getJson(
    fetchImpl,
    `https://api.telegram.org/bot${token}/getChatMemberCount?chat_id=${encodeURIComponent(chatId)}`,
  )) as { ok?: boolean; result?: unknown };
  return json.ok ? asCount(json.result) : null;
}

export async function fetchMastodonFollowers(fetchImpl: FetchFn = fetch): Promise<number | null> {
  const instance = process.env.MASTODON_INSTANCE_URL?.trim().replace(/\/$/, "");
  if (!instance) return null;
  // Same default as `lib/broadcast-channels.ts#getMastodonChannel`.
  const username = process.env.MASTODON_PROFILE_USERNAME?.trim() || "kernelia";
  const json = (await getJson(
    fetchImpl,
    `${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(username)}`,
  )) as { followers_count?: unknown };
  return asCount(json.followers_count);
}

export async function fetchBlueskyFollowers(fetchImpl: FetchFn = fetch): Promise<number | null> {
  const identifier = process.env.BLUESKY_IDENTIFIER?.trim();
  if (!identifier) return null;
  const json = (await getJson(
    fetchImpl,
    `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(identifier)}`,
  )) as { followersCount?: unknown };
  return asCount(json.followersCount);
}

export interface FetchAudienceDeps {
  telegram?: () => Promise<number | null>;
  mastodon?: () => Promise<number | null>;
  bluesky?: () => Promise<number | null>;
  newsletter?: () => Promise<number | null>;
}

/** Reads every channel in parallel; a failing channel becomes `null`. */
export async function fetchAudienceCounts(deps: FetchAudienceDeps = {}): Promise<AudienceCounts> {
  const readers: Record<AudienceChannel, () => Promise<number | null>> = {
    telegram: deps.telegram ?? (() => fetchTelegramMembers()),
    mastodon: deps.mastodon ?? (() => fetchMastodonFollowers()),
    bluesky: deps.bluesky ?? (() => fetchBlueskyFollowers()),
    newsletter: deps.newsletter ?? (async () => (await getNewsletterCounts()).confirmed),
  };
  const channels = Object.keys(readers) as AudienceChannel[];
  const values = await Promise.all(
    channels.map(async (channel) => {
      try {
        return await readers[channel]();
      } catch (err) {
        log.warn("audience_read_failed", {
          channel,
          reason: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    }),
  );
  const out = {} as AudienceCounts;
  channels.forEach((channel, i) => {
    out[channel] = values[i] ?? null;
  });
  return out;
}

/** Channels with a reading become snapshot rows; `null`s are skipped. */
export function toSnapshotRows(
  counts: AudienceCounts,
  snapshotDate: string,
): AudienceSnapshotInput[] {
  return (Object.entries(counts) as [AudienceChannel, number | null][])
    .filter((entry): entry is [AudienceChannel, number] => entry[1] !== null)
    .map(([channel, followers]) => ({ snapshotDate, channel, followers }));
}

/**
 * Reads every channel and upserts today's (Europe/Madrid) snapshot.
 * Returns the counts so callers can show them without a second fetch.
 */
export async function recordAudienceSnapshot(now: Date = new Date()): Promise<AudienceCounts> {
  const counts = await fetchAudienceCounts();
  await upsertAudienceSnapshots(toSnapshotRows(counts, getMadridDate(now)));
  return counts;
}

/**
 * Fallback for days the cron didn't run: `/admin/analytics` calls this
 * on render and it only hits the platform APIs when today has no row.
 */
export async function ensureTodayAudienceSnapshot(now: Date = new Date()): Promise<void> {
  if (await hasAudienceSnapshotFor(getMadridDate(now))) return;
  await recordAudienceSnapshot(now);
}
