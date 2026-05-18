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

export type UpsertStatus = "new" | "rearmed" | "already_active";

export interface UpsertSubscriberResult {
  subscriber: NewsletterSubscriber;
  status: UpsertStatus;
}

/**
 * Idempotent subscribe with one critical guard: an already-confirmed,
 * not-unsubscribed row is NEVER mutated. Three outcomes:
 *
 *  - `new`: no row existed → INSERT.
 *  - `rearmed`: row existed but was pending OR previously unsubscribed →
 *    UPDATE with a fresh confirm token, clearing `unsubscribed_at`. The
 *    long-lived `unsubscribe_token` is intentionally NOT rotated so old
 *    digest emails' unsubscribe links keep working.
 *  - `already_active`: row existed and was confirmed + not unsubscribed →
 *    no mutation. The caller MUST NOT send a confirmation email; doing so
 *    would (a) annoy a legitimate subscriber and (b) hand attackers an
 *    enumeration oracle.
 *
 * Without the `already_active` short-circuit, anyone could deactivate any
 * active subscriber by POSTing their email to `/api/newsletter/subscribe`
 * — `ON CONFLICT DO UPDATE` would reset `confirmed_at` to NULL and they'd
 * silently stop receiving the digest until they reconfirm.
 *
 * Implementation: a single `INSERT … ON CONFLICT DO UPDATE … WHERE` with
 * the guard predicate on the existing row. When the predicate matches no
 * row (= already active), the statement returns zero rows; we then fetch
 * the existing row via SELECT for the caller. Race-safe: a parallel insert
 * for the same email loses the conflict, falls into UPDATE, and the
 * predicate still holds because the just-inserted row has
 * `confirmed_at = NULL`.
 */
export async function upsertSubscriber(
  params: UpsertSubscriberParams,
): Promise<UpsertSubscriberResult> {
  const email = normaliseEmail(params.email);
  const row: NewNewsletterSubscriber = {
    email,
    locale: params.locale,
    confirmTokenHash: params.confirmTokenHash,
    unsubscribeToken: params.unsubscribeToken,
  };

  const upserted = await db
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
      // Only re-arm pending or unsubscribed rows. A confirmed + active row
      // is left untouched — security guard, see fn docstring.
      setWhere: sql`${newsletterSubscribers.confirmedAt} IS NULL OR ${newsletterSubscribers.unsubscribedAt} IS NOT NULL`,
    })
    .returning();

  const inserted = upserted[0];
  if (inserted) {
    // We can't distinguish INSERT vs UPDATE from the returned row alone.
    // `createdAt` is the cleanest proxy: a brand-new row's `createdAt` is
    // basically `now`, an updated row keeps its original `createdAt` from
    // before this request. 5s window absorbs any clock skew between the
    // app server and the DB.
    const status: UpsertStatus =
      Date.now() - inserted.createdAt.getTime() < 5_000 ? "new" : "rearmed";
    return { subscriber: inserted, status };
  }

  // Conflict happened AND the `setWhere` guard rejected the update — that
  // means the existing row is `confirmed_at != null AND unsubscribed_at IS
  // NULL` (already active). Fetch it so we can return a stable shape.
  const [existing] = await db
    .select()
    .from(newsletterSubscribers)
    .where(eq(newsletterSubscribers.email, email))
    .limit(1);
  if (!existing) {
    // Shouldn't happen: we just hit a unique-key conflict, the row must
    // exist. Treat as a hard error rather than papering over it.
    throw new Error("upsertSubscriber: conflict without existing row");
  }
  return { subscriber: existing, status: "already_active" };
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
