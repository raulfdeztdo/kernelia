import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  newsletterSends,
  newsletterSubscribers,
  type Locale,
  type NewNewsletterSend,
} from "@/db/schema";

/**
 * The only DB surface for `newsletter_sends`.
 *
 * Writers:
 *   - `recordNewsletterSend`: called by `runNewsletter` BEFORE the
 *     Resend HTTP call. The returned id is embedded in the email's
 *     tracking pixel URL so an open ties back to the right row.
 *   - `markNewsletterOpened`: called by `/api/track/open` when the
 *     pixel is fetched. Idempotent — only the FIRST open is
 *     recorded, mirroring what mainstream ESPs (Mailchimp, Resend)
 *     do.
 *   - `markNewsletterSendFailed`: deletes the row when the Resend
 *     call throws. We never persist a "send that didn't happen"
 *     because the admin UI would then over-report the per-subscriber
 *     send count.
 *
 * Reader: `listSubscribersWithStats` powers /admin/broadcasts'
 * subscriber tab.
 */

export interface RecordNewsletterSendParams {
  subscriberId: string;
  cronRunId: string | null;
  /** Pre-populated so the pixel URL embedded in the email lines up exactly. */
  sentAt?: Date;
  resendId?: string | null;
}

export async function recordNewsletterSend(
  params: RecordNewsletterSendParams,
): Promise<string> {
  const row: NewNewsletterSend = {
    subscriberId: params.subscriberId,
    cronRunId: params.cronRunId ?? null,
    sentAt: params.sentAt ?? new Date(),
    resendId: params.resendId ?? null,
    openedAt: null,
  };
  const [created] = await db.insert(newsletterSends).values(row).returning({ id: newsletterSends.id });
  if (!created) throw new Error("recordNewsletterSend: insert returned no row");
  return created.id;
}

/**
 * Patch the `resend_id` after the API call returns. Separated from
 * the initial INSERT because the tracking-pixel URL needs the row id
 * BEFORE we have the Resend id. Tiny round-trip; runs once per
 * subscriber per tick.
 */
export async function attachResendId(sendId: string, resendId: string): Promise<void> {
  await db
    .update(newsletterSends)
    .set({ resendId })
    .where(eq(newsletterSends.id, sendId));
}

/**
 * Roll back the pre-created row when the Resend call throws — the
 * email never went out, so persisting it as a "send" would over-count
 * the per-subscriber delivery history.
 */
export async function deleteNewsletterSend(sendId: string): Promise<void> {
  await db.delete(newsletterSends).where(eq(newsletterSends.id, sendId));
}

/**
 * First-open semantics: returns `true` when this call set
 * `opened_at`, `false` when it was already set (replay). The
 * tracking endpoint uses the return value purely for logging — the
 * pixel response is the same 1x1 PNG either way.
 */
export async function markNewsletterOpened(sendId: string): Promise<boolean> {
  const result = await db
    .update(newsletterSends)
    .set({ openedAt: new Date() })
    .where(and(eq(newsletterSends.id, sendId), isNull(newsletterSends.openedAt)))
    .returning({ id: newsletterSends.id });
  return result.length > 0;
}

export interface SubscriberStats {
  id: string;
  email: string;
  locale: Locale;
  /** `null` while the subscriber is pending double-opt-in confirmation. */
  confirmedAt: Date | null;
  /** `null` while still active. */
  unsubscribedAt: Date | null;
  createdAt: Date;
  /** Total emails this subscriber has received (via `newsletter_sends`). */
  sentCount: number;
  /** Most recent send (regardless of opened). */
  lastSentAt: Date | null;
  /** Most recent open (NULL if they've never opened any digest). */
  lastOpenedAt: Date | null;
  /** Total opens. Apple Mail Privacy inflates this; treat as directional. */
  openedCount: number;
  /**
   * Phase 8.H: category slugs the subscriber filters the digest by.
   * Empty array = no filter (all categories). The admin table renders
   * "Todas" / "All" for the empty case and lists the slugs otherwise.
   */
  preferredCategories: string[];
}

/**
 * Admin /admin/broadcasts subscriber listing. Single grouped query so
 * we don't N+1 the table — `newsletter_sends` joins with a
 * `count(*) filter (...)` aggregate. Returns ALL subscribers
 * regardless of status, ordered most-recently-created first.
 */
export async function listSubscribersWithStats(): Promise<SubscriberStats[]> {
  const rows = await db
    .select({
      id: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
      locale: newsletterSubscribers.locale,
      confirmedAt: newsletterSubscribers.confirmedAt,
      unsubscribedAt: newsletterSubscribers.unsubscribedAt,
      createdAt: newsletterSubscribers.createdAt,
      sentCount: sql<number>`count(${newsletterSends.id})::int`,
      // `max()` over a timestamp column comes back as a string from
      // postgres-js because the raw `sql<...>` template skips Drizzle's
      // column-level type mapping. Without the coercion below the admin
      // /broadcasts page crashed with `a.toISOString is not a function`
      // (formatStamp expected a Date). The narrowing is done here, in
      // the only DB surface for this column, so consumers downstream get
      // the typed shape they declare.
      lastSentAt: sql<string | null>`max(${newsletterSends.sentAt})`,
      lastOpenedAt: sql<string | null>`max(${newsletterSends.openedAt})`,
      openedCount: sql<number>`count(${newsletterSends.openedAt})::int`,
      preferredCategories: newsletterSubscribers.preferredCategories,
    })
    .from(newsletterSubscribers)
    .leftJoin(newsletterSends, eq(newsletterSends.subscriberId, newsletterSubscribers.id))
    .groupBy(newsletterSubscribers.id)
    .orderBy(desc(newsletterSubscribers.createdAt));
  return rows.map((r) => ({
    ...r,
    lastSentAt: r.lastSentAt ? new Date(r.lastSentAt) : null,
    lastOpenedAt: r.lastOpenedAt ? new Date(r.lastOpenedAt) : null,
  }));
}

export interface CronRunNewsletterSend {
  id: string;
  subscriberId: string;
  subscriberEmail: string;
  subscriberLocale: Locale;
  sentAt: Date;
  openedAt: Date | null;
  resendId: string | null;
}

/**
 * Phase 8.E: every newsletter send produced by a single cron tick.
 * Powers the `/admin/cron` expand-row detail when `job = 'newsletter'`.
 * Mirrors `listBroadcastsByCronRun` for the broadcast job.
 */
export async function listSendsByCronRun(runId: string): Promise<CronRunNewsletterSend[]> {
  return db
    .select({
      id: newsletterSends.id,
      subscriberId: newsletterSends.subscriberId,
      subscriberEmail: newsletterSubscribers.email,
      subscriberLocale: newsletterSubscribers.locale,
      sentAt: newsletterSends.sentAt,
      openedAt: newsletterSends.openedAt,
      resendId: newsletterSends.resendId,
    })
    .from(newsletterSends)
    .innerJoin(newsletterSubscribers, eq(newsletterSubscribers.id, newsletterSends.subscriberId))
    .where(eq(newsletterSends.cronRunId, runId))
    .orderBy(desc(newsletterSends.sentAt));
}
