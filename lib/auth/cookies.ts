import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from "./sessions";

/**
 * Cookie helpers for the admin session.
 *
 * The cookie carries `<sessionId>.<hmacSig>` and uses the `__Host-` prefix.
 * `__Host-` requires `Secure`, `Path=/`, no `Domain` — see RFC 6265bis. The
 * value is opaque to the browser and only meaningful to the server after
 * HMAC verification.
 */

export interface SerialiseSessionCookieOptions {
  /** Max-Age in seconds. Defaults to `SESSION_TTL_MS`. */
  maxAgeMs?: number;
  /**
   * Forces `Secure` off. ONLY for `NODE_ENV !== "production"` local dev over
   * http://localhost — the `__Host-` spec demands Secure in real deployments.
   * We still set Secure by default; pass `insecure: true` to skip it locally.
   */
  insecure?: boolean;
}

export function serialiseSessionCookie(
  signedValue: string,
  opts: SerialiseSessionCookieOptions = {},
): string {
  const maxAgeSec = Math.floor((opts.maxAgeMs ?? SESSION_TTL_MS) / 1000);
  const parts = [
    `${SESSION_COOKIE_NAME}=${signedValue}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (!opts.insecure) parts.push("Secure");
  return parts.join("; ");
}

export function serialiseSessionLogoutCookie(opts: SerialiseSessionCookieOptions = {}): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (!opts.insecure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Parses a `Cookie:` header and returns the value for `__Host-kernelia-session`
 * if present, or `null`. Does NOT verify the HMAC — callers must pass the
 * returned value through `verifySessionCookieValue` (or
 * `getUserBySessionCookie`).
 */
export function readSessionCookieFromHeader(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const pairs = cookieHeader.split(";");
  for (const raw of pairs) {
    const part = raw.trim();
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const name = part.slice(0, eq);
    if (name !== SESSION_COOKIE_NAME) continue;
    return part.slice(eq + 1);
  }
  return null;
}
