/**
 * Validates the Authorization header for /api/cron/* endpoints.
 * Expects: `Authorization: Bearer <CRON_SECRET>`.
 */
export function isAuthorizedCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return false;
  return timingSafeEqual(token, secret);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
