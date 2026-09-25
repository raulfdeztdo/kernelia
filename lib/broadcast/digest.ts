import {
  listDigestCandidates,
  recordBroadcast,
  type DigestCandidate,
} from "@/db/queries/article-broadcasts";
import { claimDigestSlot, markDigestSent, releaseDigestClaim } from "@/db/queries/channel-digests";
import type { DigestSlot } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { articleUrl, withUtm } from "@/lib/permalink";
import { getSiteUrl } from "@/lib/site";
import { escapeMarkdownV2, escapeMarkdownV2Url, truncateOnWordBoundary } from "./format";
import { DEFAULT_MIN_RELEVANCE_SCORE } from "./run";
import { postTelegram } from "./telegram";
import { BROADCAST_TIMEZONE, getMadridDate, getMadridHour } from "./window";

/**
 * Telegram digest (Phase 9.C): two messages a day instead of fourteen.
 *
 *   08:00 Europe/Madrid → "La IA de esta mañana"
 *   17:00 Europe/Madrid → "La IA de esta tarde"
 *
 * Each digest carries the ~5 most relevant articles not yet sent to the
 * channel, at most 2 per source, linking to their Kernelia pages.
 *
 * Scheduling: the endpoint is called every hour (Hepha at :10, GitHub as
 * backup). The handler works out which slot is due from the Madrid clock,
 * so DST needs no cron changes, and a late tick (Hepha rebooting at
 * 08:00) still sends the morning digest as long as it lands inside the
 * slot's window (see `DIGEST_SLOT_WINDOW`).
 * At-most-once per slot is guaranteed by the claim in `channel_digests`.
 */

const log = createLogger("digest");

export const DIGEST_PLATFORM = "telegram" as const;
/**
 * Madrid hours during which each slot may still go out, end exclusive.
 * A digest delayed past its window (scheduler down, deploy at night) is
 * skipped rather than sent late: "La IA de esta tarde" at 23:00 reads
 * like a bug, and the next slot will carry those articles anyway.
 */
export const DIGEST_SLOT_WINDOW: Record<DigestSlot, { from: number; until: number }> = {
  morning: { from: 8, until: 13 },
  afternoon: { from: 17, until: 22 },
};
export const DIGEST_SIZE = 5;
export const DIGEST_PER_SOURCE_CAP = 2;
/** Candidates older than this are yesterday's news. */
export const DIGEST_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const CANDIDATE_POOL = 60;
const SUMMARY_MAX = 170;

/** Which slot is due at `now` (Madrid wall clock), or `null` outside both windows. */
export function getDueSlot(now: Date): DigestSlot | null {
  const hour = getMadridHour(now);
  for (const slot of ["morning", "afternoon"] as const) {
    const w = DIGEST_SLOT_WINDOW[slot];
    if (hour >= w.from && hour < w.until) return slot;
  }
  return null;
}

/**
 * Top `size` by relevance with at most `perSourceCap` per source, so one
 * prolific outlet can't fill the digest. `candidates` must already be
 * sorted best-first (the query does that).
 */
export function pickDigestArticles(
  candidates: readonly DigestCandidate[],
  size = DIGEST_SIZE,
  perSourceCap = DIGEST_PER_SOURCE_CAP,
): DigestCandidate[] {
  const perSource = new Map<string, number>();
  const picked: DigestCandidate[] = [];
  for (const c of candidates) {
    if (picked.length >= size) break;
    const used = perSource.get(c.sourceName) ?? 0;
    if (used >= perSourceCap) continue;
    perSource.set(c.sourceName, used + 1);
    picked.push(c);
  }
  return picked;
}

/** First sentence of the summary, or a word-boundary cut if it runs long. */
export function digestBlurb(summary: string | null): string | null {
  if (!summary) return null;
  const text = summary.trim();
  const firstStop = text.search(/[.!?](\s|$)/);
  const sentence = firstStop > 0 ? text.slice(0, firstStop + 1) : text;
  return truncateOnWordBoundary(sentence, SUMMARY_MAX);
}

const _dateLabel = new Intl.DateTimeFormat("es-ES", {
  timeZone: BROADCAST_TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
});

const KEYCAPS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

export interface DigestItem {
  title: string;
  summary: string | null;
  link: string;
}

/** Telegram MarkdownV2 body for one digest. */
export function formatDigestMessage(params: {
  slot: DigestSlot;
  now: Date;
  items: readonly DigestItem[];
  homeLink: string;
}): string {
  const heading =
    params.slot === "morning" ? "☀️ *La IA de esta mañana*" : "🌆 *La IA de esta tarde*";
  const date = _dateLabel.format(params.now).replace(",", "");
  const lines = [heading, `_${escapeMarkdownV2(date)}_`, ""];
  params.items.forEach((item, i) => {
    lines.push(
      `${KEYCAPS[i] ?? `${i + 1}\\.`} [${escapeMarkdownV2(item.title)}](${escapeMarkdownV2Url(item.link)})`,
    );
    const blurb = digestBlurb(item.summary);
    if (blurb) lines.push(escapeMarkdownV2(blurb));
    lines.push("");
  });
  lines.push(`👉 [Todas las noticias en kernelia\\.dev](${escapeMarkdownV2Url(params.homeLink)})`);
  return lines.join("\n");
}

export type DigestOutcome =
  | "sent"
  | "disabled"
  | "not_due"
  | "already_sent"
  | "no_articles"
  | "failed";

export interface DigestSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: DigestOutcome;
  slot: DigestSlot | null;
  digestDate: string;
  articleIds: string[];
  externalId: string | null;
  error: string | null;
}

export interface RunDigestOptions {
  enabled?: boolean;
  /** Send this slot now, whatever the clock says (manual dispatch). */
  forceSlot?: DigestSlot;
  cronRunId?: string | null;
  now?: () => Date;
  minRelevanceScore?: number;
  // Injectables (default to the real DB + Telegram client).
  claim?: typeof claimDigestSlot;
  release?: typeof releaseDigestClaim;
  markSent?: typeof markDigestSent;
  listCandidates?: typeof listDigestCandidates;
  record?: typeof recordBroadcast;
  send?: (params: { text: string; linkPreviewUrl?: string }) => Promise<{ messageId: string }>;
}

function isEnvTruthy(value: string | undefined): boolean {
  return !!value && ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export async function runDigest(options: RunDigestOptions = {}): Promise<DigestSummary> {
  const clock = options.now ?? (() => new Date());
  const started = clock();
  const enabled = options.enabled ?? isEnvTruthy(process.env.BROADCAST_ENABLED);
  const claim = options.claim ?? claimDigestSlot;
  const release = options.release ?? releaseDigestClaim;
  const markSent = options.markSent ?? markDigestSent;
  const listCandidates = options.listCandidates ?? listDigestCandidates;
  const record = options.record ?? recordBroadcast;
  const send = options.send ?? ((p) => postTelegram(p));
  const minScore = options.minRelevanceScore ?? DEFAULT_MIN_RELEVANCE_SCORE;

  const digestDate = getMadridDate(started);
  const slot = options.forceSlot ?? getDueSlot(started);
  const done = (
    outcome: DigestOutcome,
    extra: Partial<Pick<DigestSummary, "articleIds" | "externalId" | "error">> = {},
  ): DigestSummary => {
    const finished = clock();
    const summary: DigestSummary = {
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      durationMs: finished.getTime() - started.getTime(),
      outcome,
      slot,
      digestDate,
      articleIds: extra.articleIds ?? [],
      externalId: extra.externalId ?? null,
      error: extra.error ?? null,
    };
    log.info("tick_done", { ...summary });
    return summary;
  };

  if (!enabled) return done("disabled");
  if (!slot) return done("not_due");

  const claimId = await claim({
    platform: DIGEST_PLATFORM,
    digestDate,
    slot,
    cronRunId: options.cronRunId ?? null,
    now: started,
  });
  if (!claimId) return done("already_sent");

  // Once Telegram has accepted the message the claim must NEVER be
  // released, even if the bookkeeping below fails: releasing would let
  // the next tick send the same digest again.
  let sentMessageId: string | null = null;
  try {
    const candidates = await listCandidates({
      platform: DIGEST_PLATFORM,
      minScore,
      since: new Date(started.getTime() - DIGEST_LOOKBACK_MS),
      limit: CANDIDATE_POOL,
    });
    const picked = pickDigestArticles(candidates);
    if (picked.length === 0) {
      // Give the slot back: a later tick in the same slot may find
      // articles (e.g. classify catching up after an outage).
      await release(claimId);
      return done("no_articles");
    }

    const campaign = `digest_${slot}`;
    const items: DigestItem[] = picked.map((a) => ({
      title: a.titleEs,
      summary: a.summaryEs,
      link: withUtm(articleUrl("es", a.id, a.titleEs), {
        source: "telegram",
        medium: "social",
        campaign,
      }),
    }));
    const text = formatDigestMessage({
      slot,
      now: started,
      items,
      homeLink: withUtm(getSiteUrl(), { source: "telegram", medium: "social", campaign }),
    });
    // The card under the message is the top story's Kernelia page.
    const { messageId } = await send({ text, linkPreviewUrl: items[0]?.link });
    sentMessageId = messageId;

    const articleIds = picked.map((a) => a.id);
    // One retry: this write is what stops the claim from ever being
    // treated as stale, so a transient DB blip deserves a second chance.
    await markSent({ id: claimId, externalId: messageId, articleIds }).catch(() =>
      markSent({ id: claimId, externalId: messageId, articleIds }),
    );
    // Record each article so the next digest doesn't repeat it. The
    // message is already out: a failure here must not release the claim.
    await Promise.all(
      articleIds.map((articleId) =>
        record({
          articleId,
          platform: DIGEST_PLATFORM,
          externalId: messageId,
          cronRunId: options.cronRunId ?? null,
        }).catch((err: unknown) => {
          log.warn("record_failed", {
            articleId,
            reason: err instanceof Error ? err.message : String(err),
          });
          return false;
        }),
      ),
    );
    return done("sent", { articleIds, externalId: messageId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (sentMessageId) {
      // Delivered, but the claim row could not be finalised even after a
      // retry. Never release it here. Residual risk, accepted and logged
      // loudly: the unsent-looking claim goes stale after 10 minutes and
      // a later tick in the same slot could send the digest again.
      log.error("digest_sent_but_not_recorded", {
        slot,
        messageId: sentMessageId,
        reason: message,
      });
      return done("sent", { externalId: sentMessageId, error: message });
    }
    log.warn("digest_failed", { slot, reason: message });
    // Nothing went out: release so a later tick in the same slot retries.
    await release(claimId).catch(() => undefined);
    return done("failed", { error: message });
  }
}
