import { z } from "zod";
import { consumeRateLimit, peekRateLimit } from "@/lib/auth/rate-limit";
import { getUserByEmail, setUserLastLogin, type User } from "@/db/queries/users";
import { verifyPassword } from "@/lib/auth/passwords";
import { createLogger } from "@/lib/logger";

/**
 * Orchestrates the email + password login flow. Extracted from the route
 * handler for the same reasons as the forgot-password flow: testable with
 * injected collaborators, and the route stays a thin HTTP shim.
 *
 * Threat model addressed here:
 * - **Account enumeration**: response copy is the same for "no such email",
 *   "wrong password" and "no password set yet". All three map to
 *   `invalid_credentials` in the outcome union. The route renders one
 *   message regardless.
 * - **Online brute-force**: bcrypt cost factor 12 caps verification rate,
 *   plus the rate limiter caps attempt-rate per IP (10/10min) and per email
 *   (5 failed attempts/15min). Successful logins do not consume the per-
 *   email budget — only failures do, otherwise a legitimate user fast-
 *   typing the wrong password once is locked out from logging in again.
 */

const log = createLogger("login_flow");

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(256),
});

// Per-IP catches dictionary attacks from one source. Per-email-FAILURE
// catches targeted attacks across IPs against a known account. The
// per-email budget is consumed only on FAILED attempts, so the legitimate
// user logging in successfully resets nothing and is not affected.
export const LOGIN_PER_IP_LIMIT = { max: 10, windowMs: 10 * 60 * 1000 };
export const LOGIN_PER_EMAIL_FAILURE_LIMIT = { max: 5, windowMs: 15 * 60 * 1000 };

export type LoginOutcome =
  | { kind: "invalid_body" }
  | { kind: "rate_limited"; reason: "ip" | "email"; retryAfterMs: number }
  | { kind: "invalid_credentials" }
  | { kind: "inactive_user" }
  | { kind: "ok"; user: User };

export interface AttemptLoginParams {
  rawBody: unknown;
  ip: string;
  // Injectables.
  findUserByEmail?: (email: string) => Promise<User | null>;
  verify?: (plaintext: string, hash: string | null) => Promise<boolean>;
  recordLastLogin?: (userId: string, when: Date) => Promise<void>;
  now?: number;
  rateLimitStore?: { hits: Map<string, number[]> };
}

/**
 * Verifies credentials. On success records `lastLoginAt`. On failure logs
 * the structured reason but always returns `invalid_credentials` so the
 * route can map every miss to the same generic message.
 */
export async function attemptLogin(params: AttemptLoginParams): Promise<LoginOutcome> {
  const parsed = credentialsSchema.safeParse(params.rawBody);
  if (!parsed.success) {
    return { kind: "invalid_body" };
  }
  const { email, password } = parsed.data;
  const now = params.now ?? Date.now();
  const store = params.rateLimitStore;

  // Per-IP gate first — cheap and protects against bursty IP-side attacks.
  const ipKey = `login:ip:${params.ip}`;
  const ipLimit = consumeRateLimit(ipKey, LOGIN_PER_IP_LIMIT, store, now);
  if (!ipLimit.allowed) {
    log.warn("rate_limited", { reason: "ip", ip: params.ip });
    return { kind: "rate_limited", reason: "ip", retryAfterMs: ipLimit.retryAfterMs };
  }

  // Per-email-failure gate. We don't consume the budget on the happy path
  // — only on the failure paths below. We peek first to see if the budget
  // is already exhausted from prior failures.
  const failureKey = `login:email-fail:${email}`;
  const failurePeek = peekRateLimit(failureKey, LOGIN_PER_EMAIL_FAILURE_LIMIT, store, now);
  if (!failurePeek.allowed) {
    log.warn("rate_limited", { reason: "email", email });
    return {
      kind: "rate_limited",
      reason: "email",
      retryAfterMs: failurePeek.retryAfterMs,
    };
  }

  const finder = params.findUserByEmail ?? getUserByEmail;
  const verifier = params.verify ?? verifyPassword;
  const recordLast = params.recordLastLogin ?? setUserLastLogin;

  const user = await finder(email);
  if (!user) {
    log.info("unknown_email", { email });
    recordLoginFailure(failureKey, store, now);
    return { kind: "invalid_credentials" };
  }
  if (!user.active) {
    log.info("inactive_user", { email });
    // Inactive users get the same opaque response as wrong password. Not
    // recording a failure for the email budget — the user can't log in
    // anyway until reactivated, and we don't want to block their email
    // bucket forever from another browser session.
    return { kind: "invalid_credentials" };
  }

  const ok = await verifier(password, user.passwordHash);
  if (!ok) {
    log.info("invalid_password", { email });
    recordLoginFailure(failureKey, store, now);
    return { kind: "invalid_credentials" };
  }

  // Record last_login asynchronously is tempting but we want it durable for
  // the audit trail before granting the session. The cost is one extra
  // round-trip per login — negligible.
  try {
    await recordLast(user.id, new Date(now));
  } catch (err) {
    // Don't block login on a metadata-write failure; just log it.
    const message = err instanceof Error ? err.message : String(err);
    log.error("last_login_write_failed", { userId: user.id, error: message });
  }

  log.info("login_ok", { email, userId: user.id });
  return { kind: "ok", user };
}

// --- internals ----------------------------------------------------------

function recordLoginFailure(
  key: string,
  store: { hits: Map<string, number[]> } | undefined,
  now: number,
): void {
  // Reuse the rate-limit consume primitive — same data shape, same
  // pruning. We ignore the `allowed` result; the call records the failure
  // regardless. Passing `store` (possibly undefined) lets the default
  // global store kick in for production callers.
  consumeRateLimit(key, LOGIN_PER_EMAIL_FAILURE_LIMIT, store, now);
}
