import { z } from "zod";
import { generateMagicLinkToken } from "@/lib/auth/tokens";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { getUserByEmail, normaliseEmail, type User } from "@/db/queries/users";
import { sendMagicLink } from "@/lib/email/send";
import { createLogger } from "@/lib/logger";

/**
 * Orchestrates the magic-link request flow. Extracted from the route handler
 * so it can be unit-tested with injected collaborators (clock, store, fetch,
 * db lookup, email sender).
 *
 * Always returns "ok" externally — the route handler will translate any
 * result into the same constant copy. This module reports the *internal*
 * outcome (`rate_limited`, `unknown_email`, `sent`, `error`) so we can log
 * and observe without leaking through the HTTP response.
 */

const log = createLogger("magic_link_flow");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email()
  .max(254);

// Limits aligned with `PLAN.md` §7.A. Per-IP catches abuse from a single
// source; per-email catches credential-stuffing across distributed IPs.
export const MAGIC_LINK_PER_IP_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };
export const MAGIC_LINK_PER_EMAIL_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };

export type MagicLinkRequestOutcome =
  | { kind: "invalid_email" }
  | { kind: "rate_limited"; reason: "ip" | "email"; retryAfterMs: number }
  | { kind: "unknown_email" }
  | { kind: "inactive_user" }
  | { kind: "sent"; userId: string }
  | { kind: "error"; message: string };

export interface RequestMagicLinkParams {
  rawEmail: unknown;
  ip: string;
  /** Absolute origin (e.g. "https://kernelia.dev") used to build the callback URL. */
  origin: string;
  // Injectables (defaults wired to real implementations).
  findUserByEmail?: (email: string) => Promise<User | null>;
  generateToken?: (userId: string) => Promise<{ plaintext: string }>;
  send?: (params: { to: string; link: string }) => Promise<unknown>;
  now?: number;
  rateLimitStore?: { hits: Map<string, number[]> };
}

/**
 * Idempotent, side-effect-aware. Caller MUST always respond with the same
 * "if that email has access, you'll receive a link" copy regardless of the
 * outcome. We never differentiate user-unknown from user-known in the HTTP
 * response — that prevents account enumeration.
 */
export async function requestMagicLink(
  params: RequestMagicLinkParams,
): Promise<MagicLinkRequestOutcome> {
  const parsed = emailSchema.safeParse(params.rawEmail);
  if (!parsed.success) {
    return { kind: "invalid_email" };
  }
  const email = parsed.data;
  const now = params.now ?? Date.now();
  const store = params.rateLimitStore;

  // Per-IP first: if a single source is hammering us, drop before doing
  // any DB / email work.
  const ipKey = `ip:${params.ip}`;
  const ipLimit = consumeRateLimit(ipKey, MAGIC_LINK_PER_IP_LIMIT, store, now);
  if (!ipLimit.allowed) {
    log.warn("rate_limited", { reason: "ip", ip: params.ip });
    return { kind: "rate_limited", reason: "ip", retryAfterMs: ipLimit.retryAfterMs };
  }
  const emailKey = `email:${email}`;
  const emailLimit = consumeRateLimit(emailKey, MAGIC_LINK_PER_EMAIL_LIMIT, store, now);
  if (!emailLimit.allowed) {
    log.warn("rate_limited", { reason: "email", email });
    return { kind: "rate_limited", reason: "email", retryAfterMs: emailLimit.retryAfterMs };
  }

  const finder = params.findUserByEmail ?? getUserByEmail;
  const generator = params.generateToken ?? ((id) => generateMagicLinkToken(id).then((r) => ({ plaintext: r.plaintext })));
  const sender = params.send ?? ((p) => sendMagicLink(p));

  const user = await finder(email);
  if (!user) {
    log.info("unknown_email", { email });
    return { kind: "unknown_email" };
  }
  if (!user.active) {
    log.info("inactive_user", { email });
    return { kind: "inactive_user" };
  }

  let token: { plaintext: string };
  try {
    token = await generator(user.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("token_generate_failed", { email, error: message });
    return { kind: "error", message };
  }

  const link = `${params.origin.replace(/\/$/, "")}/admin/auth/callback?token=${encodeURIComponent(token.plaintext)}`;

  try {
    await sender({ to: user.email, link });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("send_failed", { email, error: message });
    return { kind: "error", message };
  }

  log.info("magic_link_sent", { email, userId: user.id });
  return { kind: "sent", userId: user.id };
}

export { normaliseEmail };
