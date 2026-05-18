import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  newsletterSubscribers,
  type Locale,
  type NewsletterSubscriber,
  type NewNewsletterSubscriber,
} from "@/db/schema";

/**
 * The only DB surface for `newsletter_subscribers`.
 *
 * Lifecycle: `upsertSubscriber` is the entry point — it inserts a new row OR
 * re-arms an existing one that had previously unsubscribed (clearing
 * `unsubscribed_at` and reissuing a confirm token). `confirmByTokenHash`
 * activates the subscription. `unsubscribeByTokenHash` deactivates it. The
 * weekly digest reads via `listActiveSubscribers`.
 *
 * All emails are normalised to lowercase + trim at this layer.
 */

export type { NewsletterSubscriber } from "@/db/schema";

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface UpsertSubscriberParams {
  email: string;
  locale: Locale;
  confirmTokenHash: string;
  /**
   * Plaintext unsubscribe token. Stored verbatim (no hashing) — see schema
   * comment. Only used on first insert; an upsert keeps the existing token
   * so old digest emails' unsubscribe links keep working.
   */
  unsubscribeToken: string;
}

/**
 * Idempotent subscribe: inserts a brand-new row, or — if a row with this
 * email already exists — re-arms it with a fresh confirm token and clears
 * any prior `unsubscribed_at`. The caller is expected to send the confirm
 * email afterwards regardless of which path triggered.
 *
 * The unsubscribe token is left alone on re-arm if the row already has one;
 * we want a subscriber's unsubscribe link in old digest emails to keep
 * working even after a re-subscribe cycle.
 *
 * Returns `{ subscriber, isNew }` so callers can shape logging without
 * leaking the distinction to the user (the API stays idempotent at HTTP
 * level — same 200 either way).
 */
export async function upsertSubscriber(
  params: UpsertSubscriberParams,
): Promise<{ subscriber: NewsletterSubscriber; isNew: boolean }> {
  const email = normaliseEmail(params.email);
  const row: NewNewsletterSubscriber = {
    email,
    locale: params.locale,
    confirmTokenHash: params.confirmTokenHash,
    unsubscribeToken: params.unsubscribeToken,
  };

  // ON CONFLICT (email): set a fresh confirm hash + clear unsubscribed_at +
  // reset confirmed_at to NULL (the subscriber must re-confirm). Keep the
  // original unsubscribe token so old digest emails' unsubscribe links
  // keep working.
  const [inserted] = await db
    .insert(newsletterSubscribers)
    .values(row)
    .onConflictDoUpdate({
      target: newsletterSubscribers.email,
      set: {
        confirmTokenHash: params.confirmTokenHash,
        confirmedAt: null,
        unsubscribedAt: null,
        locale: params.locale,
      },
    })
    .returning();

  if (!inserted) throw new Error("upsertSubscriber: insert returned no row");

  // `xmax = 0` in the same statement would tell us insert vs update; without
  // it we infer from `createdAt` (a fresh row's createdAt equals now, an
  // updated one keeps its original createdAt from before this request).
  // Within a few seconds the test is unreliable, so we treat "createdAt
  // older than 5s" as "existing row was updated".
  const isNew = Date.now() - inserted.createdAt.getTime() < 5_000;
  return { subscriber: inserted, isNew };
}

/**
 * Activates a subscriber whose `confirmTokenHash` matches. Atomic: a single
 * UPDATE sets `confirmedAt` and clears `confirmTokenHash` so the link can't
 * be replayed.
 *
 * Returns the subscriber row on success, `null` if no row matched (token
 * already used, expired-by-rotation, or never existed). The caller renders
 * an identical "confirmed / link expired" page either way to avoid an
 * oracle for token enumeration.
 */
export async function confirmByTokenHash(
  confirmTokenHash: string,
): Promise<NewsletterSubscriber | null> {
  const [updated] = await db
    .update(newsletterSubscribers)
    .set({ confirmedAt: new Date(), confirmTokenHash: null })
    .where(eq(newsletterSubscribers.confirmTokenHash, confirmTokenHash))
    .returning();
  return updated ?? null;
}

/**
 * Marks a subscriber as unsubscribed by their stable unsubscribe token.
 * Idempotent: calling twice is fine, the row already has `unsubscribedAt`
 * set from the first call.
 */
export async function unsubscribeByToken(
  unsubscribeToken: string,
): Promise<NewsletterSubscriber | null> {
  const [updated] = await db
    .update(newsletterSubscribers)
    .set({ unsubscribedAt: new Date() })
    .where(eq(newsletterSubscribers.unsubscribeToken, unsubscribeToken))
    .returning();
  return updated ?? null;
}

export interface ActiveSubscriber {
  id: string;
  email: string;
  locale: Locale;
  unsubscribeToken: string;
}

/**
 * Active = `confirmedAt IS NOT NULL AND unsubscribedAt IS NULL`. Returns the
 * minimal shape the digest cron needs to render + send each row.
 */
export async function listActiveSubscribers(): Promise<ActiveSubscriber[]> {
  return db
    .select({
      id: newsletterSubscribers.id,
      email: newsletterSubscribers.email,
      locale: newsletterSubscribers.locale,
      unsubscribeToken: newsletterSubscribers.unsubscribeToken,
    })
    .from(newsletterSubscribers)
    .where(
      and(
        isNotNull(newsletterSubscribers.confirmedAt),
        isNull(newsletterSubscribers.unsubscribedAt),
      ),
    )
    .orderBy(desc(newsletterSubscribers.createdAt));
}

export interface NewsletterCounts {
  total: number;
  confirmed: number;
  unsubscribed: number;
  pending: number;
}

/** Admin metrics: row counts for the four states of a subscription. */
export async function getNewsletterCounts(): Promise<NewsletterCounts> {
  const [row] = await db
    .select({
      total: count(),
      confirmed: sql<number>`count(*) filter (where ${newsletterSubscribers.confirmedAt} is not null and ${newsletterSubscribers.unsubscribedAt} is null)::int`,
      unsubscribed: sql<number>`count(*) filter (where ${newsletterSubscribers.unsubscribedAt} is not null)::int`,
      pending: sql<number>`count(*) filter (where ${newsletterSubscribers.confirmedAt} is null and ${newsletterSubscribers.unsubscribedAt} is null)::int`,
    })
    .from(newsletterSubscribers);
  return row ?? { total: 0, confirmed: 0, unsubscribed: 0, pending: 0 };
}
