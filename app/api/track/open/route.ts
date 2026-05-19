import { markNewsletterOpened } from "@/db/queries/newsletter-sends";
import { createLogger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const log = createLogger("track_open");

/**
 * 1x1 transparent PNG that the weekly digest embeds in its footer.
 * The `id` query param is the `newsletter_sends.id` UUID; when the
 * pixel is fetched we mark `opened_at` (idempotent — only the first
 * load is recorded).
 *
 * Always returns the same 1px image regardless of whether the id
 * matched a row, was malformed, or even missing. We do NOT want to
 * leak an oracle (200 vs 404) that could be used to enumerate valid
 * send ids — if someone harvests one from a leaked email, the worst
 * they can do is flip an opened_at they couldn't have known anyway.
 *
 * Cache headers are intentionally aggressive `no-store, no-cache,
 * must-revalidate` so each open is recorded once per client open
 * action rather than coalesced across mail-client reloads.
 */

// Smallest valid 1x1 transparent PNG, base64-decoded once at module
// load. Bytes are identical to what `printf` from the `convert` CLI
// produces for a 1x1 RGBA(0,0,0,0) PNG.
const TRANSPARENT_PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

function pixelResponse(): Response {
  return new Response(TRANSPARENT_PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": TRANSPARENT_PIXEL.length.toString(),
      "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      Pragma: "no-cache",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get("id");
  // Validate the UUID shape cheaply — saves a DB round-trip for the
  // inevitable curl-the-pixel attempts and bot crawls. We accept v4
  // canonical formatting only; anything else short-circuits.
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return pixelResponse();
  }
  try {
    const firstOpen = await markNewsletterOpened(id);
    log.info("open_recorded", { sendId: id, firstOpen });
  } catch (err) {
    // Never block the pixel response on a DB error — the user still
    // gets their transparent image; we just lose this one metric.
    const message = err instanceof Error ? err.message : String(err);
    log.warn("open_persist_failed", { sendId: id, error: message });
  }
  return pixelResponse();
}
