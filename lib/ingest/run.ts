import type { Source, NewArticle } from "@/db/schema";
import { listActiveSources } from "@/db/queries/sources";
import { insertPendingArticles } from "@/db/queries/articles";
import { createLogger } from "@/lib/logger";
import { fetchFeed } from "./rss";

const log = createLogger("ingest");

export interface SourceResult {
  sourceId: string;
  sourceName: string;
  fetched: number;
  inserted: number;
  error?: string;
}

export interface IngestSummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  sources: SourceResult[];
  totals: { fetched: number; inserted: number; failedSources: number };
}

export async function runIngest(): Promise<IngestSummary> {
  const startedAt = new Date();
  const sources = await listActiveSources();
  log.info("ingest start", { sources: sources.length });

  // Sources are independent (different hosts, different RSS endpoints) so
  // we race them. Each `ingestSource` already swallows its own errors
  // into a `SourceResult` with `error`, so `Promise.all` won't short-
  // circuit on a single failing feed.
  const results = await Promise.all(sources.map((source) => ingestSource(source)));

  const finishedAt = new Date();
  const totals = results.reduce(
    (acc, r) => ({
      fetched: acc.fetched + r.fetched,
      inserted: acc.inserted + r.inserted,
      failedSources: acc.failedSources + (r.error ? 1 : 0),
    }),
    { fetched: 0, inserted: 0, failedSources: 0 },
  );

  log.info("ingest done", {
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    ...totals,
  });

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    sources: results,
    totals,
  };
}

async function ingestSource(source: Source): Promise<SourceResult> {
  try {
    const items = await fetchFeed(source);
    const rows: NewArticle[] = items.map((item) => ({
      sourceId: source.id,
      url: item.url,
      urlHash: item.urlHash,
      title: item.title,
      rawExcerpt: item.rawExcerpt || null,
      imageUrl: item.imageUrl,
      language: source.language,
      publishedAt: item.publishedAt,
    }));
    const inserted = await insertPendingArticles(rows);
    log.info("source ok", {
      source: source.name,
      fetched: items.length,
      inserted,
    });
    return {
      sourceId: source.id,
      sourceName: source.name,
      fetched: items.length,
      inserted,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("source failed", { source: source.name, error: message });
    return {
      sourceId: source.id,
      sourceName: source.name,
      fetched: 0,
      inserted: 0,
      error: message,
    };
  }
}
