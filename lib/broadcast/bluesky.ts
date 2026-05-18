import { createLogger } from "@/lib/logger";

const log = createLogger("broadcast_bluesky");

/**
 * Minimal Bluesky (AT Protocol) client for the Kernelia broadcaster.
 *
 * Two-step protocol:
 *   1. `com.atproto.server.createSession` with the handle + an app-password.
 *      Returns an `accessJwt` valid for ~2h.
 *   2. `com.atproto.repo.createRecord` with the JWT, writing a record of
 *      collection `app.bsky.feed.post`.
 *
 * The session is cached in module scope so a 30-min cron tick doesn't
 * re-auth on every article. `refreshJwt` flow is omitted on purpose:
 * we just create a new session when the cache expires — simpler, costs
 * one extra round-trip per few hours.
 *
 * Required env vars:
 *   - BLUESKY_IDENTIFIER: handle, e.g. "kernelia.dev" (you can verify
 *     the domain via DNS TXT in Bluesky settings; gives the handle
 *     credibility without uploading a personal photo).
 *   - BLUESKY_APP_PASSWORD: from Settings → Privacy and security → App
 *     passwords. NEVER use your account password directly.
 */

const PDS_URL = "https://bsky.social";

interface CachedSession {
  accessJwt: string;
  did: string;
  expiresAtMs: number;
}

// Best-effort, in-process cache. A fresh function instance on Vercel will
// auth on first post; subsequent posts in the same tick reuse the JWT.
let cached: CachedSession | null = null;
const SESSION_TTL_MS = 90 * 60 * 1000; // 90 min — under the documented ~2h

export interface BlueskyPostResult {
  /** AT URI of the new record, e.g. `at://did:plc:.../app.bsky.feed.post/...`. */
  uri: string;
  /** Content-addressable hash of the record. */
  cid: string;
}

export interface BlueskyPostParams {
  /** Plain text. Should already be ≤300 chars (see lib/broadcast/format.ts). */
  text: string;
  /**
   * If set, the client builds a richtext `link` facet for this URL so it
   * renders as a tappable hyperlink and Bluesky generates the card preview.
   * MUST be a substring of `text`.
   */
  link?: string;
  fetchImpl?: typeof fetch;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; cannot post to Bluesky`);
  return value;
}

async function getSession(fetchImpl: typeof fetch): Promise<CachedSession> {
  if (cached && cached.expiresAtMs > Date.now() + 60_000) return cached;

  const identifier = requiredEnv("BLUESKY_IDENTIFIER");
  const password = requiredEnv("BLUESKY_APP_PASSWORD");

  const res = await fetchImpl(`${PDS_URL}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "<no body>");
    throw new Error(`Bluesky session ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { accessJwt?: string; did?: string };
  if (!json.accessJwt || !json.did) {
    throw new Error("Bluesky session response missing accessJwt or did");
  }
  cached = {
    accessJwt: json.accessJwt,
    did: json.did,
    expiresAtMs: Date.now() + SESSION_TTL_MS,
  };
  return cached;
}

/**
 * Locates a URL substring inside the post text and returns its byte
 * offsets. Bluesky's richtext facets use BYTE offsets, not char offsets,
 * because the wire format is UTF-8. We use `TextEncoder` to compute them
 * — `String.prototype.indexOf` returns code-unit positions which are
 * wrong for any non-ASCII content.
 */
function findUrlFacet(
  text: string,
  url: string,
): { byteStart: number; byteEnd: number } | null {
  const idx = text.indexOf(url);
  if (idx === -1) return null;
  const encoder = new TextEncoder();
  const byteStart = encoder.encode(text.slice(0, idx)).length;
  const byteEnd = byteStart + encoder.encode(url).length;
  return { byteStart, byteEnd };
}

export async function postBluesky(params: BlueskyPostParams): Promise<BlueskyPostResult> {
  const fetchImpl = params.fetchImpl ?? fetch;
  const session = await getSession(fetchImpl);

  const record: Record<string, unknown> = {
    $type: "app.bsky.feed.post",
    text: params.text,
    createdAt: new Date().toISOString(),
    langs: ["es"],
  };
  if (params.link) {
    const offsets = findUrlFacet(params.text, params.link);
    if (offsets) {
      record.facets = [
        {
          index: offsets,
          features: [{ $type: "app.bsky.richtext.facet#link", uri: params.link }],
        },
      ];
    }
  }

  const res = await fetchImpl(`${PDS_URL}/xrpc/com.atproto.repo.createRecord`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessJwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "<no body>");
    // 401 means the session expired earlier than we thought — wipe the
    // cache so the next call re-auths.
    if (res.status === 401) cached = null;
    log.error("post_failed", { status: res.status, detail: detail.slice(0, 200) });
    throw new Error(`Bluesky createRecord ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { uri?: string; cid?: string };
  if (!json.uri || !json.cid) {
    throw new Error("Bluesky createRecord response missing uri/cid");
  }
  log.info("post_ok", { uri: json.uri });
  return { uri: json.uri, cid: json.cid };
}

/** Test-only: reset the cached session between specs. */
export function _resetBlueskySessionForTests(): void {
  cached = null;
}
