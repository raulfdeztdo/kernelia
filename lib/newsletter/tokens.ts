import { createHash, randomBytes } from "node:crypto";

/**
 * Newsletter tokens.
 *
 * Two flavours, same shape:
 *
 *  - **Confirm token**: short-lived (no TTL DB-side but cleared on use). The
 *    subscriber receives it once by email after `POST /api/newsletter/subscribe`
 *    and clicks the link to confirm. The hash is wiped on `confirmedAt` so
 *    the link cannot be replayed.
 *
 *  - **Unsubscribe token**: long-lived. Embedded in every weekly digest so
 *    the recipient always has a one-click way out. Never rotates — old digest
 *    emails must keep working after a re-subscribe cycle.
 *
 * Mechanics mirror `lib/auth/password-reset.ts`: 32-byte random base64url,
 * sha256-hashed at rest. We do not log plaintext anywhere.
 */

export const NEWSLETTER_TOKEN_BYTES = 32;

export interface GeneratedNewsletterToken {
  /** Plaintext token. Send via email, never store, never log. */
  plaintext: string;
  /** sha256 hex digest. The value persisted in the DB. */
  hash: string;
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Generates a fresh token pair (plaintext + hash). Used for both confirm
 * and unsubscribe — the shape is identical, only the lifecycle differs.
 */
export function generateNewsletterToken(): GeneratedNewsletterToken {
  const plaintext = randomBytes(NEWSLETTER_TOKEN_BYTES).toString("base64url");
  return { plaintext, hash: hashToken(plaintext) };
}
