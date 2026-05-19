import { getWeeklyDigestArticles } from "@/lib/newsletter/digest";
import { listActiveSubscribers } from "@/db/queries/newsletter";
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
  /** Inject digest fetcher. */
  fetchDigest?: (locale: "es" | "en", now: Date) => Promise<DigestArticle[]>;
  /** Inject sender (skip Resend in tests). */
  send?: typeof sendWeeklyDigest;
  /** Inject sleep. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Phase 8.D: cron-run id. Threaded through so PR 4 can persist
   * per-subscriber send rows pointing back at the run. For PR 3 this
   * is plumbed end-to-end but unused inside the loop.
   */
  cronRunId?: string | null;
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
  const fetchDigest = opts.fetchDigest ?? ((locale, now) => getWeeklyDigestArticles(locale, { now }));
  const send = opts.send ?? sendWeeklyDigest;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  // Subscribers list + both locales' digests are independent queries;
  // race them so the slow one sets the floor instead of stacking. If a
  // locale ends up unused (no subscribers chose it) the cost is one
  // cheap aggregate query.
  const [subscribers, esArticles, enArticles] = await Promise.all([
    listSubscribers(),
    fetchDigest("es", now),
    fetchDigest("en", now),
  ]);
  const articlesByLocale = { es: esArticles, en: enArticles } as const;

  const origin = getSiteUrl();
  const weekLabel = formatWeekLabel(now);

  const summary: NewsletterRunSummary = {
    attempted: 0,
    sent: 0,
    skippedNoArticles: 0,
    failed: 0,
    budgetExhausted: 0,
    digestCounts: { es: esArticles.length, en: enArticles.length },
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

    const articles = articlesByLocale[subscriber.locale];
    if (articles.length === 0) {
      summary.skippedNoArticles += 1;
      continue;
    }

    // Link to the confirmation PAGE, not the API endpoint. Email scanners
    // pre-fetch GET URLs; landing on a page that requires a POST stops
    // them from accidentally unsubscribing the recipient. See the docstring
    // on `app/api/newsletter/unsubscribe/route.ts`.
    const langPrefix = subscriber.locale === "en" ? "/en" : "";
    const unsubscribeUrl = `${origin.replace(/\/$/, "")}${langPrefix}/newsletter/unsubscribe?token=${encodeURIComponent(
      subscriber.unsubscribeToken,
    )}`;

    try {
      await send({
        to: subscriber.email,
        locale: subscriber.locale,
        unsubscribeUrl,
        articles,
        weekLabel,
      });
      summary.sent += 1;
    } catch (err) {
      summary.failed += 1;
      log.error("digest_send_failed", {
        subscriberId: subscriber.id,
        error: err instanceof Error ? err.message : "unknown",
      });
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
