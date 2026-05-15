import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { db as defaultDb } from "@/db";
import { sessions, users, type User } from "@/db/schema";

/**
 * Sessions: opaque server-side rows in `sessions`. The cookie carries only
 * `<sessionId>.<hmacSig>` — never user data. We refresh `last_used_at` on
 * every successful lookup so idle sessions can be reaped later if needed.
 */

export const SESSION_COOKIE_NAME = "__Host-kernelia-session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET env var missing or too short (need >= 32 chars). Generate with: openssl rand -hex 32",
    );
  }
  return secret;
}

export function signSessionId(sessionId: string, secret: string = getSessionSecret()): string {
  const sig = createHmac("sha256", secret).update(sessionId).digest("base64url");
  return `${sessionId}.${sig}`;
}

export function verifySessionCookieValue(
  cookieValue: string | undefined | null,
  secret: string = getSessionSecret(),
): string | null {
  if (!cookieValue || typeof cookieValue !== "string") return null;
  const dot = cookieValue.lastIndexOf(".");
  if (dot <= 0 || dot === cookieValue.length - 1) return null;
  const id = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);
  const expected = createHmac("sha256", secret).update(id).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return id;
}

export interface SessionWithUser {
  session: {
    id: string;
    userId: string;
    expiresAt: Date;
  };
  user: User;
}

export async function createSession(
  userId: string,
  opts: { db?: typeof defaultDb; now?: Date; ttlMs?: number } = {},
): Promise<{ sessionId: string; signedCookie: string; expiresAt: Date }> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const ttlMs = opts.ttlMs ?? SESSION_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttlMs);
  const [row] = await db
    .insert(sessions)
    .values({ userId, expiresAt, lastUsedAt: now })
    .returning({ id: sessions.id });
  if (!row) throw new Error("createSession: insert returned no row");
  return {
    sessionId: row.id,
    signedCookie: signSessionId(row.id),
    expiresAt,
  };
}

/**
 * Resolves a signed cookie value to a `(session, user)` pair, refreshing
 * `last_used_at`. Returns `null` for any failure (invalid signature,
 * unknown session, expired, user inactive). Never throws on bad input.
 */
export async function getUserBySessionCookie(
  cookieValue: string | undefined | null,
  opts: { db?: typeof defaultDb; now?: Date } = {},
): Promise<SessionWithUser | null> {
  const db = opts.db ?? defaultDb;
  const now = opts.now ?? new Date();
  const sessionId = verifySessionCookieValue(cookieValue);
  if (!sessionId) return null;

  const rows = await db
    .select({
      sessionId: sessions.id,
      sessionUserId: sessions.userId,
      sessionExpiresAt: sessions.expiresAt,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sessionId), gt(sessions.expiresAt, now)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (!row.user.active) return null;

  // Best-effort refresh. A failure here should not block authentication.
  try {
    await db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, sessionId));
  } catch {
    // swallow
  }

  return {
    session: {
      id: row.sessionId,
      userId: row.sessionUserId,
      expiresAt: row.sessionExpiresAt,
    },
    user: row.user,
  };
}

export async function revokeSession(
  sessionId: string,
  opts: { db?: typeof defaultDb } = {},
): Promise<void> {
  const db = opts.db ?? defaultDb;
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function revokeAllSessionsForUser(
  userId: string,
  opts: { db?: typeof defaultDb } = {},
): Promise<number> {
  const db = opts.db ?? defaultDb;
  const rows = await db
    .delete(sessions)
    .where(eq(sessions.userId, userId))
    .returning({ id: sessions.id });
  return rows.length;
}
