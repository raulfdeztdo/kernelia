import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  PasswordResetVerificationError,
  consumePasswordResetToken,
  invalidateAllResetTokensForUser,
  verifyPasswordResetToken,
} from "@/lib/auth/password-reset";
import { hashPassword, validatePasswordPolicy } from "@/lib/auth/passwords";
import { revokeAllSessionsForUser } from "@/lib/auth/sessions";
import { getUserById } from "@/db/queries/users";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("admin_reset_password");

/**
 * POST /api/admin/reset-password
 *
 * Body (`application/x-www-form-urlencoded` or JSON):
 *   - token: plaintext reset token from the email link.
 *   - password: new password. Must satisfy `validatePasswordPolicy`.
 *
 * Flow:
 *  1. Verify the token (read-only) — fail-fast on expired / used / unknown.
 *  2. Validate the new password.
 *  3. Atomically consume the token — only the winner of any concurrent
 *     race proceeds.
 *  4. Write the new bcrypt hash.
 *  5. Invalidate every other outstanding reset token for the same user
 *     (defensive — the standard flow only ever has one in flight, but if
 *     the user clicked "forgot password" twice we don't want the older
 *     link to still work).
 *  6. Revoke every active session for the user — a password reset is the
 *     point to force re-login everywhere, including a presumed attacker.
 *
 * On success redirects to `/admin/login?reset=1` so the user lands on the
 * login page with a confirmation banner.
 *
 * On failure redirects back to `/admin/reset-password?token=...&error=...`
 * keeping the token in the URL so the user can try again without going
 * back to the email link.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await readBodyFromRequest(req);
  const token = body.token;
  const password = body.password;

  if (!token) {
    return redirectResponse(req, "/admin/login?error=invalid_reset");
  }
  if (typeof password !== "string") {
    return redirectToReset(req, token, "invalid_password");
  }
  const policy = validatePasswordPolicy(password);
  if (policy !== null) {
    // The page client-side validates too but we never trust that.
    return redirectToReset(req, token, policy === "too_short" ? "too_short" : "invalid_password");
  }

  // 1) Verify before doing anything destructive.
  let userId: string;
  try {
    const verified = await verifyPasswordResetToken(token);
    userId = verified.userId;
  } catch (err) {
    if (err instanceof PasswordResetVerificationError) {
      log.warn("token_rejected", { reason: err.reason });
      return redirectResponse(req, `/admin/login?error=${encodeURIComponent(err.reason)}`);
    }
    throw err;
  }

  const user = await getUserById(userId);
  if (!user || !user.active) {
    log.warn("user_inactive_or_missing", { userId });
    return redirectResponse(req, "/admin/login?error=revoked");
  }

  // 2) Hash the new password. Done before consuming the token so a hash
  // failure doesn't burn the token.
  let newHash: string;
  try {
    newHash = await hashPassword(password);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("hash_failed", { userId, error: message });
    return redirectToReset(req, token, "invalid_password");
  }

  // 3) Atomic single-use consume — race-safe.
  try {
    await consumePasswordResetToken(token);
  } catch (err) {
    if (err instanceof PasswordResetVerificationError) {
      return redirectResponse(req, `/admin/login?error=${encodeURIComponent(err.reason)}`);
    }
    throw err;
  }

  // 4-6) Persist the new hash, invalidate remaining reset tokens for this
  //      user, and drop every active session. The three operations are
  //      independent (no data dependency between them) so we run them in
  //      parallel. We only return to the client after all three settle,
  //      so there is no observable window where the password is updated
  //      but the old sessions still work.
  const [, , revoked] = await Promise.all([
    db.update(users).set({ passwordHash: newHash }).where(eq(users.id, userId)),
    invalidateAllResetTokensForUser(userId),
    revokeAllSessionsForUser(userId),
  ]);
  log.info("password_reset_ok", { userId, sessionsRevoked: revoked });

  return redirectResponse(req, "/admin/login?reset=1");
}

interface ResetBody {
  token: string | undefined;
  password: string | undefined;
}

async function readBodyFromRequest(req: Request): Promise<ResetBody> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await req.json()) as Record<string, unknown>;
      return {
        token: typeof body.token === "string" ? body.token : undefined,
        password: typeof body.password === "string" ? body.password : undefined,
      };
    } catch {
      return { token: undefined, password: undefined };
    }
  }
  try {
    const form = await req.formData();
    const token = form.get("token");
    const password = form.get("password");
    return {
      token: typeof token === "string" ? token : undefined,
      password: typeof password === "string" ? password : undefined,
    };
  } catch {
    return { token: undefined, password: undefined };
  }
}

function pickOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

function redirectResponse(req: Request, path: string): Response {
  return NextResponse.redirect(new URL(path, pickOrigin(req)), { status: 303 });
}

function redirectToReset(req: Request, token: string, errorCode: string): Response {
  const path = `/admin/reset-password?token=${encodeURIComponent(token)}&error=${encodeURIComponent(errorCode)}`;
  return redirectResponse(req, path);
}
