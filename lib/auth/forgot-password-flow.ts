import { z } from "zod";
import { generatePasswordResetToken } from "@/lib/auth/password-reset";
import { consumeRateLimit } from "@/lib/auth/rate-limit";
import { getUserByEmail, normaliseEmail, type User } from "@/db/queries/users";
import { sendPasswordReset } from "@/lib/email/send";
import { createLogger } from "@/lib/logger";

/**
 * Orchestrates the forgot-password request flow. Same shape as the previous
 * magic-link-flow (Phase 7.A): extracted from the route handler so it can be
 * unit-tested with injected collaborators (clock, store, fetch, db lookup,
 * email sender).
 *
 * Always returns "ok" externally — the route handler maps every outcome to
 * the same "if that email is registered, you'll receive a reset link in
 * a minute" copy. This module reports the *internal* outcome
 * (`rate_limited`, `unknown_email`, `inactive_user`, `sent`, `error`) so we
 * can log and observe without leaking through the HTTP response. Account
 * enumeration is the threat we're shutting down.
 */

const log = createLogger("forgot_password_flow");

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

// Same numerical budget as the previous magic-link surface. Per-IP catches
// abuse from a single source; per-email catches a distributed campaign
// trying to spam someone's inbox with reset emails.
export const FORGOT_PASSWORD_PER_IP_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };
export const FORGOT_PASSWORD_PER_EMAIL_LIMIT = { max: 5, windowMs: 10 * 60 * 1000 };

export type ForgotPasswordOutcome =
  | { kind: "invalid_email" }
  | { kind: "rate_limited"; reason: "ip" | "email"; retryAfterMs: number }
  | { kind: "unknown_email" }
  | { kind: "inactive_user" }
  | { kind: "sent"; userId: string }
  | { kind: "error"; message: string };

export interface RequestPasswordResetParams {
  rawEmail: unknown;
  ip: string;
  /** Absolute origin (e.g. "https://kernelia.dev") used to build the reset URL. */
  origin: string;
  // Injectables (defaults wired to real implementations).
  findUserByEmail?: (email: string) => Promise<User | null>;
  generateToken?: (userId: string) => Promise<{ plaintext: string }>;
  send?: (params: { to: string; link: string }) => Promise<unknown>;
  now?: number;
  rateLimitStore?: { hits: Map<string, number[]> };
}

export async function requestPasswordReset(
  params: RequestPasswordResetParams,
): Promise<ForgotPasswordOutcome> {
  const parsed = emailSchema.safeParse(params.rawEmail);
  if (!parsed.success) {
    return { kind: "invalid_email" };
  }
  const email = parsed.data;
  const now = params.now ?? Date.now();
  const store = params.rateLimitStore;

  const ipKey = `forgot:ip:${params.ip}`;
  const ipLimit = consumeRateLimit(ipKey, FORGOT_PASSWORD_PER_IP_LIMIT, store, now);
  if (!ipLimit.allowed) {
    log.warn("rate_limited", { reason: "ip", ip: params.ip });
    return { kind: "rate_limited", reason: "ip", retryAfterMs: ipLimit.retryAfterMs };
  }
  const emailKey = `forgot:email:${email}`;
  const emailLimit = consumeRateLimit(emailKey, FORGOT_PASSWORD_PER_EMAIL_LIMIT, store, now);
  if (!emailLimit.allowed) {
    log.warn("rate_limited", { reason: "email", email });
    return { kind: "rate_limited", reason: "email", retryAfterMs: emailLimit.retryAfterMs };
  }

  const finder = params.findUserByEmail ?? getUserByEmail;
  const generator =
    params.generateToken ??
    ((id) => generatePasswordResetToken(id).then((r) => ({ plaintext: r.plaintext })));
  const sender = params.send ?? ((p) => sendPasswordReset(p));

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

  const link = `${params.origin.replace(/\/$/, "")}/admin/reset-password?token=${encodeURIComponent(
    token.plaintext,
  )}`;

  try {
    await sender({ to: user.email, link });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("send_failed", { email, error: message });
    return { kind: "error", message };
  }

  log.info("password_reset_sent", { email, userId: user.id });
  return { kind: "sent", userId: user.id };
}

export { normaliseEmail };
