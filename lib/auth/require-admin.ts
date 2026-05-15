import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, getUserBySessionCookie } from "@/lib/auth/sessions";
import type { User } from "@/db/queries/users";

/**
 * Asserts a valid admin session for an API route handler. Returns the
 * authenticated `User` on success, or a `Response` (401/403) the handler
 * should immediately return.
 *
 * Why not a layout-based guard? Layouts wrap pages, not route handlers.
 * Every `/api/admin/*` endpoint that mutates state must verify the cookie
 * itself — calling `requireAdmin` is the entry-point contract.
 *
 * Usage:
 * ```ts
 * const auth = await requireAdmin();
 * if (auth instanceof Response) return auth;
 * // auth.user is the authenticated User
 * ```
 */
export async function requireAdmin(): Promise<{ user: User } | Response> {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const result = await getUserBySessionCookie(cookie);
  if (!result) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  if (result.user.userType !== "admin") {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }
  return { user: result.user };
}
