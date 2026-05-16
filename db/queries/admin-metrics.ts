import { and, desc, eq, gte, max, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  articles,
  categories,
  cronRuns,
  sources,
  type ArticleStatus,
} from "@/db/schema";

/**
 * Admin metrics layer. Server-only, called from `/admin/*` server components.
 *
 * Keeps the read path narrow: every count is computed in Postgres in a
 * single query so the dashboard render fans out 4-5 `Promise.all`-able
 * calls and nothing else.
 */

export type ArticleStatusCounts = Record<ArticleStatus, number> & { total: number };

/**
 * Aggregate counts across the entire `articles` table by status.
 * Returns zeros for any status that has no rows yet (the enum-driven
 * `Record<ArticleStatus, number>` is filled before returning).
 */
export async function getArticleStatusCounts(): Promise<ArticleStatusCounts> {
  const rows = await db
    .select({
      status: articles.status,
      n: sql<number>`count(*)::int`,
    })
    .from(articles)
    .groupBy(articles.status);

  const out: ArticleStatusCounts = {
    pending: 0,
    classified: 0,
    failed: 0,
    hidden: 0,
    total: 0,
  };
  for (const r of rows) {
    out[r.status] = r.n;
    out.total += r.n;
  }
  return out;
}

export interface CategoryBreakdownRow {
  categoryId: string;
  slug: string;
  nameEs: string;
  nameEn: string;
  classified: number;
  hidden: number;
  pending: number;
  failed: number;
  total: number;
}

/**
 * Per-category breakdown of articles by status. Joins from `categories`
 * (left) → `articles` so categories with zero articles still appear.
 * Aggregation uses `filter (where ...)` so a single scan produces all
 * four buckets per category.
 */
export async function getCategoryBreakdown(): Promise<CategoryBreakdownRow[]> {
  const rows = await db
    .select({
      categoryId: categories.id,
      slug: categories.slug,
      nameEs: categories.nameEs,
      nameEn: categories.nameEn,
      classified: sql<number>`count(*) filter (where ${articles.status} = 'classified')::int`,
      hidden: sql<number>`count(*) filter (where ${articles.status} = 'hidden')::int`,
      pending: sql<number>`count(*) filter (where ${articles.status} = 'pending')::int`,
      failed: sql<number>`count(*) filter (where ${articles.status} = 'failed')::int`,
      total: sql<number>`count(${articles.id})::int`,
    })
    .from(categories)
    .leftJoin(articles, eq(articles.categoryId, categories.id))
    .groupBy(categories.id, categories.slug, categories.nameEs, categories.nameEn)
    .orderBy(categories.slug);
  return rows;
}

export interface SourceBreakdownRow {
  sourceId: string;
  name: string;
  active: boolean;
  total: number;
  lastIngestedAt: Date | null;
}

/**
 * Per-source counts + the most recent `ingested_at` per source. Useful to
 * spot a feed that has stopped ingesting (no new articles in days).
 */
export async function getSourceBreakdown(): Promise<SourceBreakdownRow[]> {
  const rows = await db
    .select({
      sourceId: sources.id,
      name: sources.name,
      active: sources.active,
      total: sql<number>`count(${articles.id})::int`,
      lastIngestedAt: max(articles.ingestedAt),
    })
    .from(sources)
    .leftJoin(articles, eq(articles.sourceId, sources.id))
    .groupBy(sources.id, sources.name, sources.active)
    .orderBy(sources.name);
  return rows;
}

export interface TokensPerDayRow {
  /** UTC date in `YYYY-MM-DD` form. */
  date: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  runs: number;
}

/**
 * Tokens consumed per UTC day over the last `days` (default 7). Reads from
 * `cron_runs.summary->tokens`, which `runClassify` writes via 7.C's logging
 * hook. Days with no successful classify cron emit a zero row so the
 * chart / table has a stable shape.
 *
 * Only counts `job = 'classify'` rows; ingest doesn't consume LLM tokens.
 */
export async function getTokensPerDay(days = 7): Promise<TokensPerDayRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // Postgres-side aggregation. `summary->'tokens'->>'X'` extracts JSON
  // numbers as text; cast to int before summing.
  const rows = await db
    .select({
      date: sql<string>`to_char(${cronRuns.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      promptTokens: sql<number>`coalesce(sum(((${cronRuns.summary}->'tokens'->>'prompt')::int)), 0)::int`,
      completionTokens: sql<number>`coalesce(sum(((${cronRuns.summary}->'tokens'->>'completion')::int)), 0)::int`,
      totalTokens: sql<number>`coalesce(sum(((${cronRuns.summary}->'tokens'->>'total')::int)), 0)::int`,
      runs: sql<number>`count(*)::int`,
    })
    .from(cronRuns)
    .where(and(eq(cronRuns.job, "classify"), gte(cronRuns.startedAt, since)))
    .groupBy(sql`to_char(${cronRuns.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`)
    .orderBy(desc(sql`to_char(${cronRuns.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`));

  // Fill missing days with zeros so the UI gets a stable `days`-long array.
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const result: TokensPerDayRow[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const row = byDate.get(key);
    result.push(
      row ?? {
        date: key,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        runs: 0,
      },
    );
  }
  return result;
}

export interface ClassifiedPerDayRow {
  /** UTC date in `YYYY-MM-DD` form. */
  date: string;
  /** Articles transitioned to `status='classified'` (sum across cron ticks). */
  classified: number;
  /** Articles that the LLM failed to classify that day. */
  failed: number;
  /** How many classify cron ticks ran on this UTC day. */
  runs: number;
}

/**
 * Output of the classify cron per UTC day over the last `days` (default 30).
 * Same data source as `getTokensPerDay` (`cron_runs.summary` for
 * `job='classify'`) — `classified` and `failed` are summed across the day's
 * ticks. Days with no successful run get a zero row so the chart stays
 * `days`-long.
 *
 * Why cron_runs and not `articles`: there's no `classified_at` column on
 * `articles`. The cron logs the count per tick which is the operational
 * truth we care about ("how productive was the classifier today?").
 */
export async function getClassifiedPerDay(days = 30): Promise<ClassifiedPerDayRow[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      date: sql<string>`to_char(${cronRuns.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      classified: sql<number>`coalesce(sum(((${cronRuns.summary}->>'classified')::int)), 0)::int`,
      failed: sql<number>`coalesce(sum(((${cronRuns.summary}->>'failed')::int)), 0)::int`,
      runs: sql<number>`count(*)::int`,
    })
    .from(cronRuns)
    .where(and(eq(cronRuns.job, "classify"), gte(cronRuns.startedAt, since)))
    .groupBy(sql`to_char(${cronRuns.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`)
    .orderBy(desc(sql`to_char(${cronRuns.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`));

  const byDate = new Map(rows.map((r) => [r.date, r]));
  const result: ClassifiedPerDayRow[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const row = byDate.get(key);
    result.push(row ?? { date: key, classified: 0, failed: 0, runs: 0 });
  }
  return result;
}

export interface SourceVolumeRow {
  sourceId: string;
  name: string;
  /** Articles classified in the last `days` window (the operational signal). */
  classified: number;
}

/**
 * Top-N sources by # of classified articles ingested in the last `days`.
 * Powers the horizontal bar chart on the dashboard.
 *
 * Filter is `status='classified' AND ingestedAt >= now - days`. We use
 * `ingestedAt` (not `publishedAt`) so a feed that suddenly stops produces
 * a visible drop in the chart — we want to see operational state, not
 * publishing dates that may pre-date our existence.
 *
 * Sources with zero matching rows are omitted (they'd just add empty bars).
 */
export async function getSourceVolume(opts: { days?: number; topN?: number } = {}): Promise<SourceVolumeRow[]> {
  const days = opts.days ?? 30;
  const topN = opts.topN ?? 10;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      sourceId: sources.id,
      name: sources.name,
      classified: sql<number>`count(${articles.id})::int`,
    })
    .from(sources)
    .innerJoin(articles, eq(articles.sourceId, sources.id))
    .where(and(eq(articles.status, "classified"), gte(articles.ingestedAt, since)))
    .groupBy(sources.id, sources.name)
    .orderBy(desc(sql`count(${articles.id})`))
    .limit(topN);
  return rows;
}
