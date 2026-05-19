import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  cronRuns,
  type CronJob,
  type CronRun,
  type CronRunStatus,
  type NewCronRun,
} from "@/db/schema";

/**
 * The only DB surface for the `cron_runs` table.
 *
 * Phase 8.D rewrote the lifecycle to be two-phase so child writes
 * (article inserts / classification updates / broadcasts) can carry the
 * cron-run FK in the SAME tick they happen:
 *
 *   1. Route handler calls `startCronRun({ job, startedAt })` at the
 *      very top, gets back the run id, and threads it through every
 *      DB write in that tick.
 *   2. Route handler calls `finishCronRun({ id, status, ... })` at the
 *      end, regardless of success or failure.
 *
 * A row stuck in `status: 'running'` means the handler crashed between
 * the two calls — the admin UI surfaces those so an operator can spot
 * a hard crash. `recordCronRun` is kept for backwards compat (no FK
 * needed → one-shot insert).
 */

export interface RecordCronRunParams {
  job: CronJob;
  status: CronRunStatus;
  startedAt: Date;
  finishedAt: Date;
  summary: Record<string, unknown>;
  errorMessage?: string | null;
}

export async function recordCronRun(params: RecordCronRunParams): Promise<CronRun> {
  const durationMs = Math.max(0, params.finishedAt.getTime() - params.startedAt.getTime());
  const row: NewCronRun = {
    job: params.job,
    status: params.status,
    startedAt: params.startedAt,
    finishedAt: params.finishedAt,
    durationMs,
    summary: params.summary,
    errorMessage: params.errorMessage ?? null,
  };
  const [created] = await db.insert(cronRuns).values(row).returning();
  if (!created) throw new Error("recordCronRun: insert returned no row");
  return created;
}

export interface StartCronRunParams {
  job: CronJob;
  startedAt: Date;
}

/**
 * Phase 8.D: insert a placeholder row with `status: 'running'` so the
 * tick's child writes (articles, broadcasts) can carry the FK. The
 * `finishedAt`/`durationMs` columns are populated with the start
 * instant + 0; they are rewritten by `finishCronRun` at the end. We
 * pre-populate them (instead of making them nullable) so the column
 * stays NOT NULL — the only consumers that care about durationMs
 * during a `running` row are the admin UI, which already filters
 * them out.
 */
export async function startCronRun(params: StartCronRunParams): Promise<string> {
  const [created] = await db
    .insert(cronRuns)
    .values({
      job: params.job,
      status: "running",
      startedAt: params.startedAt,
      finishedAt: params.startedAt,
      durationMs: 0,
      summary: {},
      errorMessage: null,
    } satisfies NewCronRun)
    .returning({ id: cronRuns.id });
  if (!created) throw new Error("startCronRun: insert returned no row");
  return created.id;
}

export interface FinishCronRunParams {
  id: string;
  status: CronRunStatus;
  finishedAt: Date;
  summary: Record<string, unknown>;
  errorMessage?: string | null;
}

/**
 * Pairs with `startCronRun`. Computes `durationMs` server-side via a
 * SQL fragment that references the row's own `started_at`, so the
 * whole transition fits in a single UPDATE round-trip. Flips
 * `running` → terminal.
 */
export async function finishCronRun(params: FinishCronRunParams): Promise<void> {
  await db
    .update(cronRuns)
    .set({
      status: params.status,
      finishedAt: params.finishedAt,
      // `extract(epoch from ...)` yields seconds; multiply to ms and
      // cast to int (the column type). GREATEST(0, ...) guards against
      // the edge case where clock skew between the two timestamps
      // produces a tiny negative delta.
      durationMs: sql`greatest(0, (extract(epoch from ${params.finishedAt.toISOString()}::timestamptz - ${cronRuns.startedAt}) * 1000)::int)`,
      summary: params.summary,
      errorMessage: params.errorMessage ?? null,
    })
    .where(eq(cronRuns.id, params.id));
}

/**
 * Single-row lookup for the admin detail view. Returns `null` when the
 * row doesn't exist (e.g. the operator hit the URL with a stale id).
 */
export async function getCronRunById(id: string): Promise<CronRun | null> {
  const rows = await db.select().from(cronRuns).where(eq(cronRuns.id, id)).limit(1);
  return rows[0] ?? null;
}

export interface ListCronRunsParams {
  job?: CronJob;
  status?: CronRunStatus;
  limit?: number;
}

export async function listCronRuns(params: ListCronRunsParams = {}): Promise<CronRun[]> {
  const conds = [];
  if (params.job) conds.push(eq(cronRuns.job, params.job));
  if (params.status) conds.push(eq(cronRuns.status, params.status));
  const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 500);
  const base = db.select().from(cronRuns);
  const filtered = where ? base.where(where) : base;
  return filtered.orderBy(desc(cronRuns.startedAt)).limit(limit);
}
