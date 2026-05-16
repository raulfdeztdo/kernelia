import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { passwordResetTokens } from "@/db/schema";

/**
 * Password-reset tokens.
 *
 * Replaces the previous magic-link-tokens implementation (Phase 7.A–E). The
 * mechanics are identical — sha256-hashed plaintext, single-use, atomic
 * consume — but the **purpose** is different: these tokens only let the
 * user reach `/admin/reset-password` to set a new password. They never
 * grant a session directly; only `POST /api/admin/login` does.
 *
 * TTL is intentionally shorter than a typical "set your password" link in
 * other tools. The flow is synchronous: admin adds a user, the user clicks
 * "forgot password" right after, link arrives, they set their password. 30
 * minutes is plenty and limits the blast radius of a leaked inbox.
 */

export const PASSWORD_RESET_TOKEN_BYTES = 32;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 min

export interface GeneratedPasswordResetToken {
  /** Plaintext token. Send via email, never store, never log. */
  plaintext: string;
  /** sha256 hex digest. The value persisted in the DB. */
  hash: string;
  /** Absolute expiry. */
  expiresAt: Date;
}

export function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/**
 * Generates a reset token and persists its hash. Returns the plaintext so the
 * caller can embed it in the email link. Never log `plaintext`.
 */
export async function generatePasswordResetToken(
  userId: string,
  opts: { db?: typeof defaultDb; now?: Date; ttlMs?: number } = {},
): Promise<GeneratedPasswordResetToken> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const ttlMs = opts.ttlMs ?? PASSWORD_RESET_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttlMs);

  const plaintext = randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("base64url");
  const hash = hashToken(plaintext);

  await db.insert(passwordResetTokens).values({
    userId,
    tokenHash: hash,
    expiresAt,
  });

  return { plaintext, hash, expiresAt };
}

export class PasswordResetVerificationError extends Error {
  constructor(public readonly reason: "not_found" | "expired" | "used") {
    super(`password_reset_${reason}`);
    this.name = "PasswordResetVerificationError";
  }
}

/**
 * Read-only verification: confirms the token is valid (exists, not expired,
 * not consumed) and returns the associated `userId`. Does NOT mark it used —
 * the reset-password endpoint reads the token first to render the form, then
 * consumes it only when the user actually submits a new password.
 *
 * Throws `PasswordResetVerificationError` with a typed reason on failure.
 */
export async function verifyPasswordResetToken(
  plaintext: string,
  opts: { db?: typeof defaultDb; now?: Date } = {},
): Promise<{ userId: string }> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  if (!plaintext || typeof plaintext !== "string") {
    throw new PasswordResetVerificationError("not_found");
  }
  const hash = hashToken(plaintext);

  const candidates = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      tokenHash: passwordResetTokens.tokenHash,
      expiresAt: passwordResetTokens.expiresAt,
      usedAt: passwordResetTokens.usedAt,
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hash))
    .limit(1);

  const row = candidates[0];
  if (!row) {
    throw new PasswordResetVerificationError("not_found");
  }

  const a = Buffer.from(row.tokenHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new PasswordResetVerificationError("not_found");
  }

  if (row.usedAt !== null) {
    throw new PasswordResetVerificationError("used");
  }
  if (row.expiresAt <= now) {
    throw new PasswordResetVerificationError("expired");
  }

  return { userId: row.userId };
}

/**
 * Atomic single-use consume. Returns the `userId` if this call won the race;
 * throws `PasswordResetVerificationError('used')` if another concurrent
 * request already claimed it.
 *
 * Splitting verify (read) from consume (write) lets the page render the
 * "set new password" form on GET without burning the token, then atomically
 * burn it on the POST that submits the new password.
 */
export async function consumePasswordResetToken(
  plaintext: string,
  opts: { db?: typeof defaultDb; now?: Date } = {},
): Promise<{ userId: string }> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const hash = hashToken(plaintext);

  const updated = await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hash),
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expiresAt, now),
      ),
    )
    .returning({ userId: passwordResetTokens.userId });

  const consumed = updated[0];
  if (!consumed) {
    // Either no token, expired, or already used. We pick `used` as the
    // generic label — the page will have been gated by `verifyPasswordResetToken`
    // already, so the only way to reach here with a miss is a race.
    throw new PasswordResetVerificationError("used");
  }
  return { userId: consumed.userId };
}

/** Garbage-collects tokens past their TTL or already used. */
export async function purgeStalePasswordResetTokens(
  opts: { db?: typeof defaultDb; now?: Date } = {},
): Promise<number> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const rows = await db
    .delete(passwordResetTokens)
    .where(
      sql`${passwordResetTokens.expiresAt} <= ${now} OR ${passwordResetTokens.usedAt} IS NOT NULL`,
    )
    .returning({ id: passwordResetTokens.id });
  return rows.length;
}

/**
 * Invalidates every outstanding reset token for a user. Called from the
 * reset endpoint after a new password is set, so any other in-flight links
 * for the same account stop working.
 */
export async function invalidateAllResetTokensForUser(
  userId: string,
  opts: { db?: typeof defaultDb; now?: Date } = {},
): Promise<void> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  await db
    .update(passwordResetTokens)
    .set({ usedAt: now })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
}
