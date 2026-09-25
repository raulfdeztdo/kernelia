/**
 * Best-effort client IP behind Vercel's proxy: first hop of
 * `x-forwarded-for`, then `x-real-ip`, else `"unknown"`.
 *
 * Only ever used as a rate-limit key or as hash input — never stored.
 */
export function pickClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
