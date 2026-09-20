import {
  countEligibleIgnoringLookback,
  listPendingForBroadcast,
  recordBroadcast,
  type PendingBroadcastArticle,
} from "@/db/queries/article-broadcasts";
import type { BroadcastPlatform } from "@/db/schema";
import { createLogger } from "@/lib/logger";
import { formatPost } from "./format";
import { postMastodon } from "./mastodon";
import { postBluesky } from "./bluesky";
import { postTelegram } from "./telegram";
import { isWithinBroadcastWindow } from "./window";

const log = createLogger("broadcast");

export const BROADCAST_PLATFORMS: readonly BroadcastPlatform[] = [
  "mastodon",
  "bluesky",
  "telegram",
] as const;

export const DEFAULT_MIN_RELEVANCE_SCORE = 0.75;
/**
 * How far back the cron looks for unbroadcast articles, keyed on
 * `ingested_at`. Keeps a freshly deployed broadcaster from flooding the
 * channels with weeks of backlog the first time it runs in production.
 *
 * Raised 3d → 5d after the Sep-2026 stall. The lookback is the LAST
 * line of defence against a backlog flood, not the first: the real
 * guard is `DEFAULT_LIMIT_PER_PLATFORM = 1`, which caps a tick at one
 * post per platform no matter how deep the queue is. At 3 days the
 * window was tight enough that a classify backlog could outrun it —
 * once every classified article was older than the cutoff the query
 * returned 0 rows forever, and the cron reported a clean `posted: 0`
 * while the channels sat silent for two weeks. 5 days absorbs a
 * long-weekend outage without the deadlock.
 *
 * Override per-environment with `BROADCAST_LOOKBACK_DAYS`.
 */
export const DEFAULT_LOOKBACK_DAYS = 5;
export const DEFAULT_LOOKBACK_MS = DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
/**
 * A tick that posts nothing is normally fine (nothing new cleared the
 * relevance bar). It is NOT fine when articles are queued up just
 * outside the lookback — that is the stall signature above. When an
 * in-window tick finds no candidates but eligible-ignoring-the-lookback
 * rows do exist, the summary carries `staleBacklog` and the run is
 * logged `partial` so /admin shows it instead of a silent green row.
 */
export const STALE_BACKLOG_ALERT_THRESHOLD = 1;
/** Articles per platform per tick.
 *
 *  Product rule: ONE article per hour per platform during waking hours
 *  in Spain (see `./window.ts`). A higher limit would burst-publish
 *  several items the moment a window opens — exactly the "saturating
 *  notification" pattern we want to avoid. The cron now ticks hourly
 *  and skips out-of-window hours, so 1/hour spreads the day cleanly
 *  across 14 windows.
 */
export const DEFAULT_LIMIT_PER_PLATFORM = 1;
/** Sleep between consecutive posts on the SAME platform. */
const POST_DELAY_MS = 2_000;

export interface PlatformSummary {
  posted: number;
  failed: number;
  /** Articles skipped because of formatting errors. Rare. */
  skipped: number;
}

export interface BroadcastSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /** Bool from `BROADCAST_ENABLED` env. When false, no DB reads either. */
  enabled: boolean;
  /**
   * `true` when the tick was outside the Europe/Madrid publishing window
   * (see `./window.ts`) and bailed before touching the DB or any
   * platform. Always `false` on a normal in-window run, and on
   * `respectWindow: false` (manual dispatch) regardless of clock.
   */
  skippedWindow: boolean;
  minRelevanceScore: number;
  /** Per-platform counters. Keys are always present, even on disabled-run. */
  posted: Record<BroadcastPlatform, number>;
  failed: Record<BroadcastPlatform, number>;
  /** Sum across platforms of articles that couldn't be formatted. */
  skipped: number;
  /**
   * Stall detector. Non-null only on an in-window tick that posted
   * nothing: the count of articles that clear every eligibility rule
   * EXCEPT the lookback. `0` means "genuinely nothing to say" (the
   * healthy quiet tick); anything higher means the classify backlog has
   * aged past the window and posts are being silently dropped — the
   * Sep-2026 failure mode. `null` on ticks that did post, are disabled,
   * or bailed out of window.
   */
  staleBacklog: number | null;
}

export type PlatformPostFn = (article: PendingBroadcastArticle) => Promise<{ externalId: string }>;

export interface RunBroadcastOptions {
  /** Override the env-derived flag. */
  enabled?: boolean;
  /** Override `BROADCAST_MIN_RELEVANCE_SCORE`. */
  minRelevanceScore?: number;
  /** Override `DEFAULT_LIMIT_PER_PLATFORM`. */
  limitPerPlatform?: number;
  /** Override `DEFAULT_LOOKBACK_MS`. */
  lookbackMs?: number;
  /** Wall-clock budget in ms; loop bails cleanly before going over. */
  maxWallTimeMs?: number;
  /**
   * When `true` (the default for scheduled cron ticks), the run bails
   * out before doing any work if the current Europe/Madrid hour is not
   * in `BROADCAST_LOCAL_HOURS`. Set to `false` for manual dispatches
   * from `/admin/cron` so admins can publish on demand outside the
   * window.
   */
  respectWindow?: boolean;
  /**
   * Phase 8.D: cron-run id stamped into `article_broadcasts.cron_run_id`
   * for every post this tick records. Null leaves the column NULL
   * (back-compat with rows that pre-date the migration).
   */
  cronRunId?: string | null;
  // Injectables (defaults wired to the real DB + HTTP clients).
  listPending?: (params: {
    platform: BroadcastPlatform;
    minScore: number;
    since: Date;
    limit: number;
  }) => Promise<PendingBroadcastArticle[]>;
  record?: (params: {
    articleId: string;
    platform: BroadcastPlatform;
    externalId?: string | null;
    cronRunId?: string | null;
  }) => Promise<boolean>;
  /** Map of platform → post function. Defaults to the real HTTP clients. */
  platformPosters?: Partial<Record<BroadcastPlatform, PlatformPostFn>>;
  /** Bypass the inter-post sleep; tests pass `() => Promise.resolve()`. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Injectable stall probe; defaults to the real DB count. */
  countEligible?: (params: { minScore: number }) => Promise<number>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultPosters(): Record<BroadcastPlatform, PlatformPostFn> {
  return {
    mastodon: async (article) => {
      const text = formatPost(article, "mastodon");
      const res = await postMastodon({ status: text, idempotencyKey: `art-${article.id}` });
      return { externalId: res.id };
    },
    bluesky: async (article) => {
      const text = formatPost(article, "bluesky");
      const res = await postBluesky({ text, link: article.url });
      return { externalId: res.uri };
    },
    telegram: async (article) => {
      const text = formatPost(article, "telegram");
      const res = await postTelegram({ text });
      return { externalId: res.messageId };
    },
  };
}

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

/**
 * `BROADCAST_LOOKBACK_DAYS` override. Anything unparseable, non-positive
 * or absurdly large falls back to the default rather than silently
 * widening the window to "forever" on a typo.
 */
function readLookbackMs(override: number | undefined): number {
  if (typeof override === "number") return override;
  const raw = process.env.BROADCAST_LOOKBACK_DAYS;
  if (!raw) return DEFAULT_LOOKBACK_MS;
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n) || n <= 0 || n > 365) return DEFAULT_LOOKBACK_MS;
  return n * 24 * 60 * 60 * 1000;
}

function readMinScore(override: number | undefined): number {
  if (typeof override === "number") return override;
  const raw = process.env.BROADCAST_MIN_RELEVANCE_SCORE;
  if (!raw) return DEFAULT_MIN_RELEVANCE_SCORE;
  const n = Number.parseFloat(raw);
  if (Number.isNaN(n) || n < 0 || n > 1) return DEFAULT_MIN_RELEVANCE_SCORE;
  return n;
}

/**
 * Drives one tick of the broadcast cron. Per-platform work runs in
 * parallel (independent rate limits, independent failures); within a
 * single platform we post serially with a `POST_DELAY_MS` gap.
 *
 * Idempotency: every successful post is recorded in `article_broadcasts`
 * before we move on. If the function dies mid-loop, the unique index +
 * the `notExists` clause in `listPendingForBroadcast` ensure the next
 * tick picks up exactly the un-recorded items.
 *
 * Partial failure: a platform throwing doesn't affect the others — we
 * just bump its `failed` counter. The article stays unrecorded for that
 * platform and the next tick retries.
 */
export async function runBroadcast(options: RunBroadcastOptions = {}): Promise<BroadcastSummary> {
  const startedAt = new Date();
  const now = options.now ?? Date.now;
  const enabled = options.enabled ?? isEnvTruthy(process.env.BROADCAST_ENABLED);
  const minScore = readMinScore(options.minRelevanceScore);
  const limitPerPlatform = options.limitPerPlatform ?? DEFAULT_LIMIT_PER_PLATFORM;
  const lookbackMs = readLookbackMs(options.lookbackMs);
  const maxWallTimeMs = options.maxWallTimeMs ?? Infinity;
  const respectWindow = options.respectWindow ?? true;
  const cronRunId = options.cronRunId ?? null;
  const sleep = options.sleep ?? defaultSleep;
  const listPending = options.listPending ?? listPendingForBroadcast;
  const record = options.record ?? recordBroadcast;
  const countEligible = options.countEligible ?? countEligibleIgnoringLookback;
  const realPosters = defaultPosters();
  const posters: Record<BroadcastPlatform, PlatformPostFn> = {
    mastodon: options.platformPosters?.mastodon ?? realPosters.mastodon,
    bluesky: options.platformPosters?.bluesky ?? realPosters.bluesky,
    telegram: options.platformPosters?.telegram ?? realPosters.telegram,
  };

  const posted: Record<BroadcastPlatform, number> = { mastodon: 0, bluesky: 0, telegram: 0 };
  const failed: Record<BroadcastPlatform, number> = { mastodon: 0, bluesky: 0, telegram: 0 };
  let skipped = 0;

  log.info("tick_start", { enabled, minScore, limitPerPlatform });

  if (!enabled) {
    log.info("tick_skipped_disabled");
    const finishedAt = new Date();
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      enabled: false,
      skippedWindow: false,
      minRelevanceScore: minScore,
      posted,
      failed,
      skipped,
      staleBacklog: null,
    };
  }

  // Out-of-window short-circuit. We bail BEFORE the DB read so an
  // hourly tick at 03:00 local is essentially free — no Supabase
  // round-trip, no LLM call, no platform fetch. Manual dispatches from
  // /admin/cron pass `respectWindow: false` to override.
  if (respectWindow && !isWithinBroadcastWindow(new Date(now()))) {
    log.info("tick_skipped_window");
    const finishedAt = new Date();
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      enabled: true,
      skippedWindow: true,
      minRelevanceScore: minScore,
      posted,
      failed,
      skipped,
      staleBacklog: null,
    };
  }

  const since = new Date(now() - lookbackMs);
  const startMs = now();

  // Run all platforms in parallel — each is independent (own rate limit,
  // own auth, own failure mode). The wall-clock budget is shared though;
  // each platform self-bails when elapsed approaches `maxWallTimeMs`.
  await Promise.all(
    BROADCAST_PLATFORMS.map(async (platform) => {
      const pending = await listPending({ platform, minScore, since, limit: limitPerPlatform });
      log.info("platform_batch", { platform, count: pending.length });

      // Per-platform loop is serial on purpose: each platform has its own
      // rate limit (Mastodon ~1 req/s, Bluesky stricter, Telegram bot API
      // can 429 on bursts) and `POST_DELAY_MS` between posts keeps us
      // safely below. Parallelising posts inside a platform would defeat
      // the throttle. React Review's `async-await-in-loop` is a false
      // positive in this exact spot.
      /* eslint-disable react-review/async-await-in-loop */
      for (let i = 0; i < pending.length; i++) {
        if (now() - startMs >= maxWallTimeMs) {
          log.info("platform_budget_exhausted", {
            platform,
            remaining: pending.length - i,
          });
          break;
        }
        const article = pending[i];
        if (!article) continue;

        if (i > 0) await sleep(POST_DELAY_MS);

        try {
          // Defensive: skip articles with no titleEs. Should be impossible
          // because the query filters for it, but a NULL slipping in here
          // shouldn't take down the tick.
          if (!article.titleEs) {
            skipped++;
            log.warn("skip_no_title_es", { articleId: article.id, platform });
            continue;
          }
          const result = await posters[platform](article);
          const recorded = await record({
            articleId: article.id,
            platform,
            externalId: result.externalId,
            cronRunId,
          });
          if (recorded) {
            posted[platform]++;
            log.info("article_posted", {
              platform,
              articleId: article.id,
              externalId: result.externalId,
            });
          } else {
            // Lost the race to a parallel tick. Not an error.
            log.info("article_already_recorded", { platform, articleId: article.id });
          }
        } catch (err) {
          failed[platform]++;
          const message = err instanceof Error ? err.message : String(err);
          log.warn("article_post_failed", { platform, articleId: article.id, reason: message });
        }
      }
      /* eslint-enable react-review/async-await-in-loop */
    }),
  );

  // Stall probe. Only runs on a tick that published nothing anywhere —
  // on a normal tick it would be a pointless extra round-trip. It
  // answers the one question the old summary could not: "was this a
  // quiet hour, or is the lookback silently swallowing a backlog?"
  const totalPosted = posted.mastodon + posted.bluesky + posted.telegram;
  const totalFailed = failed.mastodon + failed.bluesky + failed.telegram;
  let staleBacklog: number | null = null;
  if (totalPosted === 0 && totalFailed === 0) {
    try {
      staleBacklog = await countEligible({ minScore });
    } catch (err) {
      // Never let the diagnostic take down the tick it is diagnosing.
      const message = err instanceof Error ? err.message : String(err);
      log.warn("stale_probe_failed", { reason: message });
    }
    if (staleBacklog !== null && staleBacklog >= STALE_BACKLOG_ALERT_THRESHOLD) {
      log.warn("stale_backlog_detected", {
        staleBacklog,
        lookbackDays: lookbackMs / (24 * 60 * 60 * 1000),
      });
    }
  }

  const finishedAt = new Date();
  const summary: BroadcastSummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    enabled: true,
    skippedWindow: false,
    minRelevanceScore: minScore,
    posted,
    failed,
    skipped,
    staleBacklog,
  };
  log.info("tick_done", { ...summary });
  return summary;
}
