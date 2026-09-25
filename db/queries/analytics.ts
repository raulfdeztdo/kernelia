import { and, asc, desc, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  analyticsEvents,
  articles,
  audienceSnapshots,
  type AudienceChannel,
  type NewAnalyticsEvent,
} from "@/db/schema";

/**
 * The only DB surface for first-party analytics (Phase 9.A).
 *
 * Writes come from `/api/pulse` (one row per beacon hit) and from the
 * audience snapshotter. Reads power `/admin/analytics`; every aggregate
 * is a single grouped query so the page fans out a handful of
 * `Promise.all`-able calls.
 *
 * Days are bucketed in Europe/Madrid, the timezone the operator reads
 * the panel in (same as the broadcast window).
 */

// Inlined as a SQL literal (constant, never user input): passed as a bind
// parameter, the SELECT and GROUP BY copies of the day expression get
// different placeholders and Postgres rejects them as non-grouped.
const TZ_SQL = sql.raw("'Europe/Madrid'");

/**
 * Inserts one event. `articleId` is resolved through a sub-select so a
 * stale or forged id from the beacon degrades to NULL instead of failing
 * the FK — analytics must never 500 because an article was purged.
 */
export async function insertAnalyticsEvent(row: NewAnalyticsEvent): Promise<void> {
  const { articleId, ...rest } = row;
  await db.insert(analyticsEvents).values({
    ...rest,
    articleId: articleId
      ? sql`(select ${articles.id} from ${articles} where ${articles.id} = ${articleId})`
      : null,
  });
}

/** Retention: hard-delete events older than `before`. Returns rows removed. */
export async function deleteAnalyticsEventsBefore(before: Date): Promise<number> {
  const rows = await db
    .delete(analyticsEvents)
    .where(lt(analyticsEvents.occurredAt, before))
    .returning({ id: analyticsEvents.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// Dashboard reads
// ---------------------------------------------------------------------------

export interface AnalyticsTotals {
  pageviews: number;
  /** Distinct daily visitor hashes — i.e. "visitor-days", see schema docs. */
  visitors: number;
  outbound: number;
  cta: number;
}

export async function getAnalyticsTotals(from: Date, to: Date): Promise<AnalyticsTotals> {
  const [row] = await db
    .select({
      pageviews: sql<number>`count(*) filter (where ${analyticsEvents.event} = 'pageview')::int`,
      visitors: sql<number>`count(distinct ${analyticsEvents.visitorHash}) filter (where ${analyticsEvents.event} = 'pageview')::int`,
      outbound: sql<number>`count(*) filter (where ${analyticsEvents.event} = 'outbound')::int`,
      cta: sql<number>`count(*) filter (where ${analyticsEvents.event} = 'cta')::int`,
    })
    .from(analyticsEvents)
    .where(and(gte(analyticsEvents.occurredAt, from), lt(analyticsEvents.occurredAt, to)));
  return row ?? { pageviews: 0, visitors: 0, outbound: 0, cta: 0 };
}

export interface DailyTrafficRow {
  /** `YYYY-MM-DD` in Europe/Madrid. */
  day: string;
  pageviews: number;
  visitors: number;
}

/**
 * One row per day that had at least one pageview. The caller fills the
 * gaps so the chart x-axis stays continuous.
 */
export async function getDailyTraffic(from: Date, to: Date): Promise<DailyTrafficRow[]> {
  const day = sql<string>`to_char(${analyticsEvents.occurredAt} at time zone ${TZ_SQL}, 'YYYY-MM-DD')`;
  return db
    .select({
      day,
      pageviews: sql<number>`count(*)::int`,
      visitors: sql<number>`count(distinct ${analyticsEvents.visitorHash})::int`,
    })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.event, "pageview"),
        gte(analyticsEvents.occurredAt, from),
        lt(analyticsEvents.occurredAt, to),
      ),
    )
    .groupBy(day)
    .orderBy(asc(day));
}

export interface BreakdownRow {
  label: string;
  count: number;
  visitors: number;
}

type Dimension = "path" | "source" | "country" | "device" | "cta" | "outbound";

/**
 * Generic "top N by dimension" over a window. `source` collapses the
 * attribution chain the way readers think about it: an explicit UTM
 * wins (our own broadcasts tag their links), then the referrer host,
 * then "(directo)".
 */
export async function getBreakdown(
  dimension: Dimension,
  from: Date,
  to: Date,
  limit = 10,
): Promise<BreakdownRow[]> {
  const label = (() => {
    switch (dimension) {
      case "path":
        return sql<string>`${analyticsEvents.path}`;
      case "source":
        return sql<string>`coalesce(${analyticsEvents.utmSource}, ${analyticsEvents.referrerHost}, '(directo)')`;
      case "country":
        return sql<string>`coalesce(${analyticsEvents.country}, '??')`;
      case "device":
        return sql<string>`coalesce(${analyticsEvents.device}, 'desconocido')`;
      case "cta":
      case "outbound":
        return sql<string>`coalesce(${analyticsEvents.target}, '?')`;
    }
  })();
  const event = dimension === "cta" ? "cta" : dimension === "outbound" ? "outbound" : "pageview";

  return db
    .select({
      label,
      count: sql<number>`count(*)::int`,
      visitors: sql<number>`count(distinct ${analyticsEvents.visitorHash})::int`,
    })
    .from(analyticsEvents)
    .where(
      and(
        eq(analyticsEvents.event, event),
        gte(analyticsEvents.occurredAt, from),
        lt(analyticsEvents.occurredAt, to),
      ),
    )
    .groupBy(label)
    .orderBy(desc(sql`count(*)`), asc(label))
    .limit(limit);
}

export interface TopArticleRow {
  articleId: string;
  title: string;
  url: string;
  pageviews: number;
  outbound: number;
}

/**
 * Articles ranked by total interactions (views of their page + clicks to
 * the original source). Only events tied to an article are counted.
 */
export async function getTopArticles(from: Date, to: Date, limit = 10): Promise<TopArticleRow[]> {
  const pageviews = sql<number>`count(*) filter (where ${analyticsEvents.event} = 'pageview')::int`;
  const outbound = sql<number>`count(*) filter (where ${analyticsEvents.event} = 'outbound')::int`;
  return db
    .select({
      articleId: articles.id,
      title: sql<string>`coalesce(${articles.titleEs}, ${articles.title})`,
      url: articles.url,
      pageviews,
      outbound,
    })
    .from(analyticsEvents)
    .innerJoin(articles, eq(articles.id, analyticsEvents.articleId))
    .where(
      and(
        isNotNull(analyticsEvents.articleId),
        gte(analyticsEvents.occurredAt, from),
        lt(analyticsEvents.occurredAt, to),
      ),
    )
    .groupBy(articles.id, articles.titleEs, articles.title, articles.url)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Audience snapshots
// ---------------------------------------------------------------------------

export interface AudienceSnapshotInput {
  /** `YYYY-MM-DD` in Europe/Madrid. */
  snapshotDate: string;
  channel: AudienceChannel;
  followers: number;
}

/** Upsert: the last reading of the day wins. */
export async function upsertAudienceSnapshots(rows: AudienceSnapshotInput[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(audienceSnapshots)
    .values(rows)
    .onConflictDoUpdate({
      target: [audienceSnapshots.snapshotDate, audienceSnapshots.channel],
      set: { followers: sql`excluded.followers`, createdAt: sql`now()` },
    });
}

export async function hasAudienceSnapshotFor(snapshotDate: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(audienceSnapshots)
    .where(eq(audienceSnapshots.snapshotDate, snapshotDate))
    .limit(1);
  return Boolean(row);
}

export interface AudienceSnapshotRow {
  snapshotDate: string;
  channel: AudienceChannel;
  followers: number;
}

export async function listAudienceSnapshotsSince(
  sinceDate: string,
): Promise<AudienceSnapshotRow[]> {
  return db
    .select({
      snapshotDate: audienceSnapshots.snapshotDate,
      channel: audienceSnapshots.channel,
      followers: audienceSnapshots.followers,
    })
    .from(audienceSnapshots)
    .where(gte(audienceSnapshots.snapshotDate, sinceDate))
    .orderBy(asc(audienceSnapshots.snapshotDate), asc(audienceSnapshots.channel));
}
