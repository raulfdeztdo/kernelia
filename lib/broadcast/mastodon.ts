import { createLogger } from "@/lib/logger";

const log = createLogger("broadcast_mastodon");

/**
 * Minimal Mastodon client for the Kernelia broadcaster.
 *
 * We talk to the v1 REST API directly with `fetch` (no SDK) — one POST
 * per status, bearer auth. If we ever need streaming or media upload,
 * revisit.
 *
 * Required env vars:
 *   - MASTODON_INSTANCE_URL: e.g. "https://fosstodon.org"
 *   - MASTODON_ACCESS_TOKEN: app token with `write:statuses` scope.
 *
 * The token is generated at Settings → Development → New Application
 * (only `write:statuses` is required; nothing else is needed for this
 * use case).
 */

export interface MastodonPostResult {
  /** Mastodon status id, stored as `external_id`. */
  id: string;
}

export interface MastodonPostParams {
  status: string;
  /**
   * Optional. Mastodon supports unlisted / private / direct. We use
   * "public" for broadcast posts — the whole point is discovery.
   */
  visibility?: "public" | "unlisted" | "private";
  /**
   * Idempotency key. Mastodon honors it server-side: if we re-send the
   * same key within ~1h the server returns the original status instead
   * of duplicating. Useful when a cron tick retries after a network
   * hiccup. We pass the article id; uniqueness across platforms is
   * guaranteed by the per-platform unique index in `article_broadcasts`.
   */
  idempotencyKey?: string;
  fetchImpl?: typeof fetch;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; cannot post to Mastodon`);
  return value;
}

export async function postMastodon(params: MastodonPostParams): Promise<MastodonPostResult> {
  const instance = requiredEnv("MASTODON_INSTANCE_URL").replace(/\/$/, "");
  const token = requiredEnv("MASTODON_ACCESS_TOKEN");
  const fetchImpl = params.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (params.idempotencyKey) {
    headers["Idempotency-Key"] = params.idempotencyKey;
  }

  const res = await fetchImpl(`${instance}/api/v1/statuses`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      status: params.status,
      visibility: params.visibility ?? "public",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "<no body>");
    log.error("post_failed", { status: res.status, detail: detail.slice(0, 200) });
    throw new Error(`Mastodon ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) {
    throw new Error("Mastodon response missing `id`");
  }
  log.info("post_ok", { id: json.id });
  return { id: json.id };
}
