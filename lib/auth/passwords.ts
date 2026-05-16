import { compare, hash } from "bcrypt-ts";

/**
 * Password hashing for the admin backoffice.
 *
 * Uses `bcrypt-ts` (pure-JS bcrypt) so the module runs on Vercel's serverless
 * runtime without native bindings. Bcrypt is the safe-default choice for a
 * Node app circa 2026: well-understood, calibrated cost factor, no special
 * setup. Argon2id is in principle better but requires a wasm/native binding
 * that complicates the build for marginal benefit at this scale.
 *
 * Storage shape: a single `password_hash` text column on `users` that holds
 * the bcrypt-encoded string (algo + cost + salt + digest, e.g. `$2b$12$...`).
 * NULL means "no password set yet" — the user must bootstrap via the
 * `/admin/forgot-password` flow. We never store plaintext anywhere, including
 * logs.
 */

/**
 * Minimum length we accept on a new password. 12 chars is the floor: not so
 * short that brute-force is realistic, not so long that operators can't
 * remember it. We don't impose complexity rules (uppercase / digit / symbol)
 * — modern guidance (NIST 800-63B) explicitly recommends length over
 * composition. The login surface is rate-limited separately.
 */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Bcrypt cost factor. 12 ≈ ~250ms per hash on modern serverless hardware —
 * fast enough not to time out a login but slow enough to defeat offline
 * attacks against a leaked hash. Raising this is a backwards-compatible
 * server-side change.
 */
const BCRYPT_COST = 12;

export type PasswordPolicyError = "too_short" | "too_long" | "not_a_string";

/**
 * Asserts a candidate password meets the policy. Returns `null` on success,
 * or a typed error code so the caller can map it to user-facing copy.
 *
 * We cap at 256 chars too: bcrypt only uses the first 72 bytes anyway, but
 * accepting megabyte-long inputs is a DoS vector on the hash itself.
 */
export function validatePasswordPolicy(candidate: unknown): PasswordPolicyError | null {
  if (typeof candidate !== "string") return "not_a_string";
  if (candidate.length < PASSWORD_MIN_LENGTH) return "too_short";
  if (candidate.length > 256) return "too_long";
  return null;
}

/**
 * Hashes a password with the configured cost factor. Throws if the input
 * fails the policy — callers should validate first and surface the typed
 * error to the user, rather than discovering it here.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  const policy = validatePasswordPolicy(plaintext);
  if (policy !== null) {
    throw new Error(`password policy violation: ${policy}`);
  }
  return hash(plaintext, BCRYPT_COST);
}

/**
 * Constant-time verify. Returns `false` (not throw) on any malformed hash so
 * the login route can treat "no password set" identically to "wrong
 * password" — both deserve the same generic `invalid_credentials` response.
 */
export async function verifyPassword(plaintext: string, storedHash: string | null): Promise<boolean> {
  if (typeof plaintext !== "string" || plaintext.length === 0) return false;
  if (typeof storedHash !== "string" || storedHash.length === 0) return false;
  try {
    return await compare(plaintext, storedHash);
  } catch {
    return false;
  }
}
