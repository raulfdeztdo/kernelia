import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { magicLinkTokens } from "@/db/schema";

/**
 * Magic-link tokens.
 *
 * Plaintext lives only in the URL that travels to the user's inbox. The DB
 * stores `sha256(plaintext)` (hex). Verification is constant-time, single-use,
 * and time-bounded (TTL 15 min).
 */

export const MAGIC_LINK_TOKEN_BYTES = 32;
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000; // 15 min

export interface GeneratedMagicLink {
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
 * Generates a magic-link token and persists its hash. Returns the plaintext
 * so the caller can embed it in the email link. Never log `plaintext`.
 */
export async function generateMagicLinkToken(
  userId: string,
  opts: { db?: typeof defaultDb; now?: Date; ttlMs?: number } = {},
): Promise<GeneratedMagicLink> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const ttlMs = opts.ttlMs ?? MAGIC_LINK_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttlMs);

  const plaintext = randomBytes(MAGIC_LINK_TOKEN_BYTES).toString("base64url");
  const hash = hashToken(plaintext);

  await db.insert(magicLinkTokens).values({
    userId,
    tokenHash: hash,
    expiresAt,
  });

  return { plaintext, hash, expiresAt };
}

export class MagicLinkVerificationError extends Error {
  constructor(public readonly reason: "not_found" | "expired" | "used") {
    super(`magic_link_${reason}`);
    this.name = "MagicLinkVerificationError";
  }
}

interface ConsumeResult {
  userId: string;
}

/**
 * Verifies a magic-link token in constant time, then atomically marks it
 * `used_at = now()`. If two requests race for the same token, only one wins
 * (the UPDATE narrows the row by `used_at IS NULL`).
 *
 * Throws `MagicLinkVerificationError` with a typed reason on failure.
 */
export async function verifyAndConsumeMagicLink(
  plaintext: string,
  opts: { db?: typeof defaultDb; now?: Date } = {},
): Promise<ConsumeResult> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  if (!plaintext || typeof plaintext !== "string") {
    throw new MagicLinkVerificationError("not_found");
  }
  const hash = hashToken(plaintext);

  // First read by hash. We use timingSafeEqual on the digest as a belt-and-
  // braces measure — Postgres column lookup is already constant-ish, but a
  // narrowed query then explicit constant-time compare guards against any
  // future regression.
  const candidates = await db
    .select({
      id: magicLinkTokens.id,
      userId: magicLinkTokens.userId,
      tokenHash: magicLinkTokens.tokenHash,
      expiresAt: magicLinkTokens.expiresAt,
      usedAt: magicLinkTokens.usedAt,
    })
    .from(magicLinkTokens)
    .where(eq(magicLinkTokens.tokenHash, hash))
    .limit(1);

  const row = candidates[0];
  if (!row) {
    throw new MagicLinkVerificationError("not_found");
  }

  const a = Buffer.from(row.tokenHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    // Should be impossible given the WHERE clause, but be paranoid.
    throw new MagicLinkVerificationError("not_found");
  }

  if (row.usedAt !== null) {
    throw new MagicLinkVerificationError("used");
  }
  if (row.expiresAt <= now) {
    throw new MagicLinkVerificationError("expired");
  }

  // Atomic single-use: only the first UPDATE that catches `used_at IS NULL`
  // succeeds. Concurrent attempts return zero rows.
  const updated = await db
    .update(magicLinkTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(magicLinkTokens.id, row.id),
        isNull(magicLinkTokens.usedAt),
        gt(magicLinkTokens.expiresAt, now),
      ),
    )
    .returning({ userId: magicLinkTokens.userId });

  const consumed = updated[0];
  if (!consumed) {
    // Lost the race or expired between SELECT and UPDATE.
    throw new MagicLinkVerificationError("used");
  }
  return { userId: consumed.userId };
}

/**
 * Garbage-collects tokens whose `expires_at` is in the past or already used.
 * Optional maintenance; not on a cron yet.
 */
export async function purgeStaleMagicLinkTokens(
  opts: { db?: typeof defaultDb; now?: Date } = {},
): Promise<number> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const rows = await db
    .delete(magicLinkTokens)
    .where(sql`${magicLinkTokens.expiresAt} <= ${now} OR ${magicLinkTokens.usedAt} IS NOT NULL`)
    .returning({ id: magicLinkTokens.id });
  return rows.length;
}
