import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type NewUser, type User, type UserType } from "@/db/schema";

// Re-export domain types so route handlers / flow modules consume `User`
// from the queries surface (the only allowed DB surface), not from
// `@/db/schema` directly.
export type { User, UserType } from "@/db/schema";

/**
 * The only DB surface for the `users` table. UI / route handlers MUST go
 * through these helpers — never import `users` directly from `@/db/schema`
 * outside this file (except for inferring types in tests).
 */

/** Normalises an email for storage and lookup: trim + lowercase. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, normaliseEmail(email)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getUserById(id: string): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface CreateUserParams {
  email: string;
  userType?: UserType;
}

export async function createUser(params: CreateUserParams): Promise<User> {
  const row: NewUser = {
    email: normaliseEmail(params.email),
    userType: params.userType ?? "admin",
    active: true,
  };
  const [created] = await db.insert(users).values(row).returning();
  if (!created) throw new Error("createUser: insert returned no row");
  return created;
}

export async function listUsers(): Promise<User[]> {
  return db.select().from(users).orderBy(asc(users.createdAt));
}

export async function setUserActive(id: string, active: boolean): Promise<User | null> {
  const [updated] = await db
    .update(users)
    .set({ active })
    .where(eq(users.id, id))
    .returning();
  if (!updated) return null;
  if (!active) {
    // Revoking → drop sessions so the user is logged out immediately.
    await db.delete(sessions).where(eq(sessions.userId, id));
  }
  return updated;
}

export async function setUserLastLogin(id: string, when: Date): Promise<void> {
  await db.update(users).set({ lastLoginAt: when }).where(eq(users.id, id));
}

export async function deleteUser(id: string): Promise<boolean> {
  const rows = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });
  return rows.length > 0;
}

/**
 * Counts admins that are currently active. Used by the guard that prevents
 * `deleteUser`/`setUserActive(false)` from leaving the system without any
 * admin able to log in.
 */
export async function countActiveAdmins(opts: { excludeUserId?: string } = {}): Promise<number> {
  const where = opts.excludeUserId
    ? and(eq(users.userType, "admin"), eq(users.active, true), ne(users.id, opts.excludeUserId))
    : and(eq(users.userType, "admin"), eq(users.active, true));
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(users)
    .where(where);
  return rows[0]?.n ?? 0;
}
