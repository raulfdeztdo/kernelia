import type { Locale } from "@/i18n/routing";
import { OG_CARDS_BUCKET, articleOgImageUrl, ogCardStorageUrl } from "@/lib/permalink";

/**
 * Supabase Storage I/O for the pre-rendered social cards (phase 9.D).
 *
 * Plain REST over `fetch` instead of `@supabase/supabase-js`: three calls
 * don't justify a dependency, and the worker on Hepha runs this outside
 * Next.js. Writes need the service-role key, so `StorageClient` is only
 * built by the worker; Vercel only reads the public URL.
 */

export interface StorageConfig {
  /** `NEXT_PUBLIC_SUPABASE_URL`, e.g. `https://<ref>.supabase.co`. */
  supabaseUrl: string;
  /** `SUPABASE_SERVICE_ROLE`. Never shipped to the browser. */
  serviceKey: string;
  fetchImpl?: typeof fetch;
}

/** Cards are immutable per article; let Supabase's CDN keep them a week. */
const CARD_CACHE_CONTROL = "max-age=604800";
const LIST_PAGE_SIZE = 1000;

export class StorageClient {
  private readonly base: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(config: StorageConfig) {
    this.base = `${config.supabaseUrl.replace(/\/+$/, "")}/storage/v1`;
    this.headers = { Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey };
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  /** Uploads (or replaces) one object. */
  async upload(path: string, body: Uint8Array, contentType = "image/png"): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/object/${OG_CARDS_BUCKET}/${path}`, {
      method: "POST",
      headers: {
        ...this.headers,
        "Content-Type": contentType,
        "Cache-Control": CARD_CACHE_CONTROL,
        "x-upsert": "true",
      },
      body,
    });
    if (!res.ok) throw new Error(`storage upload ${path}: HTTP ${res.status} ${await res.text()}`);
  }

  /** Object names directly under `prefix` (e.g. `es/`), without the prefix. */
  async list(prefix: string): Promise<string[]> {
    const names: string[] = [];
    for (let offset = 0; ; offset += LIST_PAGE_SIZE) {
      const res = await this.fetchImpl(`${this.base}/object/list/${OG_CARDS_BUCKET}`, {
        method: "POST",
        headers: { ...this.headers, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, limit: LIST_PAGE_SIZE, offset }),
      });
      if (!res.ok) throw new Error(`storage list ${prefix}: HTTP ${res.status} ${await res.text()}`);
      const page = (await res.json()) as { name: string }[];
      names.push(...page.map((o) => o.name));
      if (page.length < LIST_PAGE_SIZE) return names;
    }
  }

  /** Deletes the given object paths (no-op for an empty list). */
  async remove(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const res = await this.fetchImpl(`${this.base}/object/${OG_CARDS_BUCKET}`, {
      method: "DELETE",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: paths }),
    });
    if (!res.ok) throw new Error(`storage remove: HTTP ${res.status} ${await res.text()}`);
  }
}

/**
 * The card URL for a channel that downloads the image itself (Bluesky):
 * the Storage copy when it exists, else the `/api/og` route, which still
 * renders it. The HEAD costs a few ms and only runs once per post.
 */
export async function resolveOgCardUrl(
  locale: Locale,
  articleId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const stored = ogCardStorageUrl(locale, articleId);
  if (stored) {
    try {
      const res = await fetchImpl(stored, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
      if (res.ok) return stored;
    } catch {
      // Fall back to the route: a post without its card is worse than a render.
    }
  }
  return articleOgImageUrl(locale, articleId);
}
