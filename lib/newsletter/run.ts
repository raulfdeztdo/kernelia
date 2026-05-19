import { digestCacheKey, getWeeklyDigestArticles } from "@/lib/newsletter/digest";
import { listActiveSubscribers } from "@/db/queries/newsletter";
import {
  attachResendId as defaultAttachResendId,
  deleteNewsletterSend as defaultDeleteSend,
  recordNewsletterSend as defaultRecordSend,
} from "@/db/queries/newsletter-sends";
import { sendWeeklyDigest } from "@/lib/email/send";
import { createLogger } from "@/lib/logger";
import { getSiteUrl } from "@/lib/site";
import type { ActiveSubscriber } from "@/db/queries/newsletter";
import type { DigestArticle } from "@/lib/newsletter/digest";

/**
 * Weekly-digest orchestrator. Called by `/api/cron/newsletter` every Sunday
 * at 10:00 UTC.
 *
 * Shape:
 *   1. Pull `listActiveSubscribers()` (confirmed + not unsubscribed).
 *   2. Cache the top-N article list per locale (we only fetch once per
 *      locale instead of N times per subscriber).
 *   3. Loop subscribers, send one email each. Sleep between sends to stay
 *      under Resend's 2/s rate limit on the free tier.
 *   4. Tally and return a summary the cron route persists to `cron_runs`.
 *
 * If a locale has zero articles above threshold, every subscriber on that
 * locale is `skipped` — we'd rather skip a week than send an empty digest.
 *
 * Wall-clock budget mirrors the broadcast/classify cron: stop pulling new
 * subscribers from the loop once we cross the budget, finalise the summary,
 * return 200. The DB row tags the result as `partial` so the admin sees the
 * truncation.
 */

const log = createLogger("newsletter_run");

/** Default delay between sends. Resend free tier allows 2/sec → 600ms is safe. */
export const DEFAULT_SEND_INTERVAL_MS = 600;

export interface NewsletterRunOptions {
  /** Hard wall-clock budget in ms; default `52_000` to leave headroom on Vercel. */
  maxWallTimeMs?: number;
  /** Sleep between sends. */
  sendIntervalMs?: number;
  /** Inject `now` for tests. */
  now?: Date;
  /** Inject subscriber list. */
  listSubscribers?: () => Promise<ActiveSubscriber[]>;
  /**
   * Inject digest fetcher. Receives the subscriber's category
   * preferences as a third argument — empty array means "no filter"
   * (= all categories). Tests can ignore the slugs param and return
   * a single fixed list per locale; production resolves it to
   * `getWeeklyDigestArticles(locale, { now, categorySlugs })`.
   */
  fetchDigest?: (
    locale: "es" | "en",
    now: Date,
    categorySlugs: readonly string[],
  ) => Promise<DigestArticle[]>;
  /** Inject sender (skip Resend in tests). */
  send?: typeof sendWeeklyDigest;
  /** Inject sleep. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Phase 8.D / 8.E: cron-run id threaded into every
   * `newsletter_sends` row this tick creates. `null` (the default
   * for manual `runNewsletter()` calls from tests) skips the FK.
   */
  cronRunId?: string | null;
  /**
   * Phase 8.E injectables. Production wires these to the real
   * `db/queries/newsletter-sends.ts` helpers; tests pass spies to
   * assert the call shape without touching the DB.
   */
  recordSend?: (params: {
    subscriberId: string;
    cronRunId: string | null;
  }) => Promise<string>;
  attachResendId?: (sendId: string, resendId: string) => Promise<void>;
  deleteSend?: (sendId: string) => Promise<void>;
}

export interface NewsletterRunSummary {
  /** Subscribers attempted (sent or skipped, not blocked by budget). */
  attempted: number;
  /** Emails delivered to Resend with a 200 (`{ id }` returned). */
  sent: number;
  /** Subscribers skipped because their locale had no articles this week. */
  skippedNoArticles: number;
  /** Send attempts that failed (Resend non-2xx, network error). */
  failed: number;
  /** Subscribers left in the queue when the wall-clock budget elapsed. */
  budgetExhausted: number;
  /** Articles in each locale's digest snapshot. */
  digestCounts: { es: number; en: number };
}

export async function runNewsletter(
  opts: NewsletterRunOptions = {},
): Promise<NewsletterRunSummary> {
  const startedAt = Date.now();
  const maxWallTimeMs = opts.maxWallTimeMs ?? 52_000;
  const sendIntervalMs = opts.sendIntervalMs ?? DEFAULT_SEND_INTERVAL_MS;
  const now = opts.now ?? new Date();
  const listSubscribers = opts.listSubscribers ?? listActiveSubscribers;
  const fetchDigest =
    opts.fetchDigest ??
    ((locale, now, categorySlugs) =>
      getWeeklyDigestArticles(locale, { now, categorySlugs }));
  const send = opts.send ?? sendWeeklyDigest;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const cronRunId = opts.cronRunId ?? null;
  const recordSend = opts.recordSend ?? defaultRecordSend;
  const attachResendId = opts.attachResendId ?? defaultAttachResendId;
  const deleteSend = opts.deleteSend ?? defaultDeleteSend;

  const subscribers = await listSubscribers();

  // Phase 8.H: digests are now keyed by (locale, sorted-category-slugs) so
  // a subscriber with `preferredCategories = ["llm"]` gets a top-N
  // computed over LLM only, not the global top-N filtered down. The
  // cache is shared across subscribers — most fall into one of a few
  // buckets (commonly "all" + a couple of explicit picks), so the
  // per-subscriber cost stays near 1 query per unique bucket.
  //
  // The cache is intentionally local to this run: stale across ticks
  // is not a concern (weekly cadence) and we'd rather pay a few extra
  // selects than thread shared state through cron invocations.
  const digestCache = new Map<string, DigestArticle[]>();
  async function resolveDigest(
    locale: "es" | "en",
    categorySlugs: readonly string[],
  ): Promise<DigestArticle[]> {
    const key = digestCacheKey(locale, categorySlugs);
    const hit = digestCache.get(key);
    if (hit) return hit;
    const fresh = await fetchDigest(locale, now, categorySlugs);
    digestCache.set(key, fresh);
    return fresh;
  }

  // Pre-warm the "all categories" digest for each locale: nearly every
  // subscriber falls into this bucket, and fetching them in parallel
  // up front lets the per-subscriber loop hit the cache. Per-slug
  // buckets are resolved lazily inside the loop.
  const [esAllArticles, enAllArticles] = await Promise.all([
    resolveDigest("es", []),
    resolveDigest("en", []),
  ]);

  const origin = getSiteUrl();
  const weekLabel = formatWeekLabel(now);

  const summary: NewsletterRunSummary = {
    attempted: 0,
    sent: 0,
    skippedNoArticles: 0,
    failed: 0,
    budgetExhausted: 0,
    digestCounts: { es: esAllArticles.length, en: enAllArticles.length },
  };

  // Serial on purpose: Resend's transactional API has a per-second
  // request limit and the `sendIntervalMs` gap below keeps us under it.
  // Parallelising would spike to 429s in seconds. React Review's
  // `async-await-in-loop` is a false positive in this exact spot.
  /* eslint-disable react-review/async-await-in-loop */
  for (const subscriber of subscribers) {
    if (Date.now() - startedAt > maxWallTimeMs) {
      // Stop pulling new work; the remaining subscribers will be picked up
      // on the next manual dispatch (or next week's tick).
      summary.budgetExhausted = subscribers.length - summary.attempted;
      break;
    }
    summary.attempted += 1;

    /* eslint-disable react-review/async-await-in-loop */
    const articles = await resolveDigest(subscriber.locale, subscriber.preferredCategories);
    /* eslint-enable react-review/async-await-in-loop */
    if (articles.length === 0) {
      summary.skippedNoArticles += 1;
      continue;
    }

    // Link to the confirmation PAGE, not the API endpoint. Email scanners
    // pre-fetch GET URLs; landing on a page that requires a POST stops
    // them from accidentally unsubscribing the recipient. See the docstring
    // on `app/api/newsletter/unsubscribe/route.ts`.
    const langPrefix = subscriber.locale === "en" ? "/en" : "";
    const baseOrigin = origin.replace(/\/$/, "");
    const unsubscribeUrl = `${baseOrigin}${langPrefix}/newsletter/unsubscribe?token=${encodeURIComponent(
      subscriber.unsubscribeToken,
    )}`;
    // Phase 8.H: same long-lived token, different page. Letting the
    // subscriber tune their category selection without unsubscribing
    // is a soft alternative we surface in the footer next to the
    // unsubscribe link.
    const preferencesUrl = `${baseOrigin}${langPrefix}/newsletter/preferences?token=${encodeURIComponent(
      subscriber.unsubscribeToken,
    )}`;

    // Phase 8.E: pre-create the `newsletter_sends` row so the
    // tracking pixel URL we embed in the email can target it. If
    // this insert fails (DB hiccup), fall back to a send WITHOUT
    // tracking — we still want the digest to go out, we just lose
    // this one open metric.
    let sendId: string | null = null;
    try {
      sendId = await recordSend({ subscriberId: subscriber.id, cronRunId });
    } catch (err) {
      log.warn("send_record_failed", {
        subscriberId: subscriber.id,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
    const trackingPixelUrl = sendId
      ? `${origin.replace(/\/$/, "")}/api/track/open?id=${sendId}`
      : undefined;

    try {
      const result = await send({
        to: subscriber.email,
        locale: subscriber.locale,
        unsubscribeUrl,
        preferencesUrl,
        articles,
        weekLabel,
        trackingPixelUrl,
      });
      summary.sent += 1;
      // Best-effort attach of the Resend id so the admin UI can
      // show "Resend message <abc>" alongside the open status. If
      // this fails the send still counts — we already have the row
      // from `recordSend`.
      if (sendId) {
        await attachResendId(sendId, result.id).catch((err: unknown) => {
          log.warn("send_attach_resend_id_failed", {
            sendId,
            error: err instanceof Error ? err.message : "unknown",
          });
        });
      }
    } catch (err) {
      summary.failed += 1;
      log.error("digest_send_failed", {
        subscriberId: subscriber.id,
        error: err instanceof Error ? err.message : "unknown",
      });
      // Roll back the placeholder row: Resend rejected the email,
      // so there's no "send" to attribute. Without this the admin
      // listing would over-count delivery history.
      if (sendId) {
        await deleteSend(sendId).catch((rollbackErr: unknown) => {
          log.warn("send_rollback_failed", {
            sendId,
            error: rollbackErr instanceof Error ? rollbackErr.message : "unknown",
          });
        });
      }
    }

    // Throttle between sends regardless of success: the next iteration's
    // budget check will exit if we're past the wall-clock.
    await sleep(sendIntervalMs);
  }
  /* eslint-enable react-review/async-await-in-loop */

  log.info("newsletter_run_done", {
    attempted: summary.attempted,
    sent: summary.sent,
    failed: summary.failed,
    budgetExhausted: summary.budgetExhausted,
    skippedNoArticles: summary.skippedNoArticles,
    durationMs: Date.now() - startedAt,
  });
  return summary;
}

/**
 * Maps the run summary to a cron-runs row status. Anything other than a
 * clean sweep is `partial` so the admin sees there was friction; only a
 * total wipe (zero subscribers AND no articles) is `ok` by itself.
 */
export function newsletterStatus(
  summary: NewsletterRunSummary,
): "ok" | "partial" | "failed" {
  if (summary.failed > 0 || summary.budgetExhausted > 0) return "partial";
  if (summary.skippedNoArticles > 0 && summary.sent === 0) return "partial";
  return "ok";
}

/**
 * Returns `"18 May 2026"` or `"18 may 2026"`-style label for the digest
 * subject line. Always English-month-name to keep the subject identical
 * across locales (the body is already localised). Date is the Sunday the
 * digest fires.
 */
function formatWeekLabel(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
