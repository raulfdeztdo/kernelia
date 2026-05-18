import { z } from "zod";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { upsertSubscriber } from "@/db/queries/newsletter";
import { generateNewsletterToken, hashToken } from "@/lib/newsletter/tokens";
import { sendNewsletterConfirmation } from "@/lib/email/send";
import { createLogger } from "@/lib/logger";
import type { Locale } from "@/db/schema";

/**
 * Orchestrates `POST /api/newsletter/subscribe`. Pulled out of the route
 * handler so it can be unit-tested with injected collaborators (rate-limit
 * store, persistence, email).
 *
 * Like the admin forgot-password flow, the HTTP response is uniform across
 * outcomes — the only signal a client sees is "you'll get a confirmation
 * email if the address is valid". The internal outcome lets us log and
 * react in tests.
 */

const log = createLogger("newsletter_subscribe");

export const subscribeEmailSchema = z.string().trim().toLowerCase().email().max(254);
export const subscribeLocaleSchema = z.enum(["es", "en"]);

// Per-IP: throttle a single client. Per-email: throttle a distributed
// attempt to spam someone's inbox with confirmation links.
export const SUBSCRIBE_PER_IP_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };
export const SUBSCRIBE_PER_EMAIL_LIMIT = { max: 3, windowMs: 10 * 60 * 1000 };

export type SubscribeOutcome =
  | { kind: "invalid_email" }
  | { kind: "rate_limited"; reason: "ip" | "email"; retryAfterMs: number }
  | { kind: "sent"; subscriberId: string; status: "new" | "rearmed" }
  | { kind: "noop_already_active"; subscriberId: string }
  | { kind: "error"; message: string };

export interface SubscribeParams {
  rawEmail: unknown;
  rawLocale: unknown;
  ip: string;
  origin: string;
  // Injectables for tests.
  upsert?: typeof upsertSubscriber;
  send?: (params: {
    to: string;
    locale: Locale;
    confirmUrl: string;
  }) => Promise<unknown>;
  now?: number;
  rateLimitStore?: { hits: Map<string, number[]> };
}

export async function subscribeToNewsletter(params: SubscribeParams): Promise<SubscribeOutcome> {
  const emailParsed = subscribeEmailSchema.safeParse(params.rawEmail);
  if (!emailParsed.success) {
    return { kind: "invalid_email" };
  }
  const email = emailParsed.data;
  // Locale defaults to "es" — the project's default — if the caller didn't
  // (or couldn't) supply one. Anything other than the two enum values falls
  // back to `es` rather than 400'ing, since the form is best-effort.
  const localeParsed = subscribeLocaleSchema.safeParse(params.rawLocale);
  const locale: Locale = localeParsed.success ? localeParsed.data : "es";

  const now = params.now ?? Date.now();
  const store = params.rateLimitStore;

  const ipKey = `newsletter:ip:${params.ip}`;
  const ipLimit = consumeRateLimit(ipKey, SUBSCRIBE_PER_IP_LIMIT, store, now);
  if (!ipLimit.allowed) {
    log.warn("rate_limited", { reason: "ip", ip: params.ip });
    return { kind: "rate_limited", reason: "ip", retryAfterMs: ipLimit.retryAfterMs };
  }
  const emailKey = `newsletter:email:${email}`;
  const emailLimit = consumeRateLimit(emailKey, SUBSCRIBE_PER_EMAIL_LIMIT, store, now);
  if (!emailLimit.allowed) {
    log.warn("rate_limited", { reason: "email", email });
    return { kind: "rate_limited", reason: "email", retryAfterMs: emailLimit.retryAfterMs };
  }

  const upsert = params.upsert ?? upsertSubscriber;
  const sender = params.send ?? sendNewsletterConfirmation;

  const confirmTokenPair = generateNewsletterToken();
  const unsubscribeTokenPair = generateNewsletterToken();

  let row: Awaited<ReturnType<typeof upsertSubscriber>>;
  try {
    row = await upsert({
      email,
      locale,
      confirmTokenHash: confirmTokenPair.hash,
      // The unsubscribe token is only used on first-insert; on a re-arm the
      // upsert keeps the existing one (see the query). Pass our generated
      // plaintext so a brand-new row gets a valid token.
      unsubscribeToken: unsubscribeTokenPair.plaintext,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("upsert_failed", { email, error: message });
    return { kind: "error", message };
  }

  // Already-active short-circuit. If the row was confirmed AND not
  // unsubscribed, we did NOT mutate it (the DB-side `setWhere` guard
  // refused the update) — see `upsertSubscriber`. We also must NOT send a
  // confirmation email here: doing so would (a) bother a legitimate
  // subscriber every time someone POSTs their address and (b) reveal —
  // by the very existence of an inbox-side email — that the address is
  // on the list, which is the same enumeration oracle the uniform
  // HTTP response was designed to close.
  //
  // The HTTP layer renders this outcome with the same 200/{ok:true} as a
  // genuine new subscribe; the caller only sees `kind` for logging.
  if (row.status === "already_active") {
    log.info("subscribe_noop_already_active", { email, subscriberId: row.subscriber.id });
    return { kind: "noop_already_active", subscriberId: row.subscriber.id };
  }

  // Link to the confirmation PAGE, not the API endpoint. Email scanners
  // pre-fetch GET URLs; landing on a page that requires a POST stops
  // them from silently activating spoofed signups. See the docstring
  // on `app/api/newsletter/confirm/route.ts`.
  const origin = params.origin.replace(/\/$/, "");
  const langPrefix = row.subscriber.locale === "en" ? "/en" : "";
  const confirmUrl = `${origin}${langPrefix}/newsletter/confirm?token=${encodeURIComponent(
    confirmTokenPair.plaintext,
  )}`;

  try {
    await sender({ to: row.subscriber.email, locale: row.subscriber.locale, confirmUrl });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("send_failed", { email, error: message });
    return { kind: "error", message };
  }

  log.info("confirmation_sent", { email, subscriberId: row.subscriber.id, status: row.status });
  return { kind: "sent", subscriberId: row.subscriber.id, status: row.status };
}

// Re-export the hash helper for tests that want to drive the confirm path
// without the full email round-trip.
export { hashToken };
