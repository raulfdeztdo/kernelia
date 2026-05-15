import { and, desc, eq } from "drizzle-orm";
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
 * Writers: `runIngest` and `runClassify` call `recordCronRun` at the end
 * of every tick to persist a structured summary. The monitor in
 * `/admin/cron` reads via `listCronRuns`.
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
