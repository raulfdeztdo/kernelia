import Link from "next/link";
import { listCronRuns } from "@/db/queries/cron-runs";
import type { CronJob, CronRun, CronRunStatus } from "@/db/schema";

export const dynamic = "force-dynamic";

const JOB_LABEL: Record<CronJob, string> = {
  ingest: "Ingest",
  classify: "Classify",
  broadcast: "Broadcast",
  newsletter: "Newsletter",
};
const STATUS_LABEL: Record<CronRunStatus, string> = {
  ok: "OK",
  partial: "Parcial",
  failed: "Fallido",
};
const STATUS_TONE: Record<CronRunStatus, string> = {
  ok: "text-accent",
  partial: "text-amber-400",
  failed: "text-red-400",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const isJob = (v: unknown): v is CronJob =>
  v === "ingest" || v === "classify" || v === "broadcast" || v === "newsletter";
const isStatus = (v: unknown): v is CronRunStatus =>
  v === "ok" || v === "partial" || v === "failed";

export default async function CronMonitorPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const jobFilter = isJob(sp.job) ? sp.job : undefined;
  const statusFilter = isStatus(sp.status) ? sp.status : undefined;

  const runs = await listCronRuns({ job: jobFilter, status: statusFilter, limit: 50 });

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Monitor del cron</h1>
        <Link href="/admin" className="text-sm text-accent underline-offset-2 hover:underline">
          ← Panel
        </Link>
      </header>

      <FilterBar job={jobFilter} status={statusFilter} />

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Inicio (UTC)</th>
              <th className="px-3 py-2 font-medium">Job</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Duración</th>
              <th className="px-3 py-2 font-medium">Resumen</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-muted-foreground" colSpan={5}>
                  Sin ejecuciones que coincidan con los filtros.
                </td>
              </tr>
            ) : (
              runs.map((r) => <Row key={r.id} run={r} />)
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Mostrando las 50 ejecuciones más recientes. Las anteriores se mantienen en la tabla{" "}
        <code>cron_runs</code> de Supabase pero no se muestran aquí en V1.
      </p>
    </div>
  );
}

function FilterBar({ job, status }: { job?: CronJob; status?: CronRunStatus }) {
  return (
    <form action="/admin/cron" method="get" className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-xs">
        <span className="block uppercase tracking-wide text-muted-foreground">Job</span>
        <select
          name="job"
          defaultValue={job ?? ""}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Todos</option>
          <option value="ingest">Ingest</option>
          <option value="classify">Classify</option>
          <option value="broadcast">Broadcast</option>
          <option value="newsletter">Newsletter</option>
        </select>
      </label>
      <label className="space-y-1 text-xs">
        <span className="block uppercase tracking-wide text-muted-foreground">Estado</span>
        <select
          name="status"
          defaultValue={status ?? ""}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Todos</option>
          <option value="ok">OK</option>
          <option value="partial">Parcial</option>
          <option value="failed">Fallido</option>
        </select>
      </label>
      <button
        type="submit"
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Filtrar
      </button>
      <Link
        href="/admin/cron"
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
      >
        Limpiar
      </Link>
    </form>
  );
}

function Row({ run }: { run: CronRun }) {
  const summary = summariseRun(run);
  return (
    <tr className="border-t border-border align-top last:border-b">
      <td className="px-3 py-2 tabular-nums">
        <time dateTime={run.startedAt.toISOString()}>
          {run.startedAt.toISOString().replace("T", " ").slice(0, 19)}
        </time>
      </td>
      <td className="px-3 py-2">{JOB_LABEL[run.job]}</td>
      <td className={`px-3 py-2 font-medium ${STATUS_TONE[run.status]}`}>
        {STATUS_LABEL[run.status]}
      </td>
      <td className="px-3 py-2 tabular-nums text-muted-foreground">
        {(run.durationMs / 1000).toFixed(1)}s
      </td>
      <td className="px-3 py-2 text-xs">
        <pre className="whitespace-pre-wrap break-words text-muted-foreground">{summary}</pre>
        {run.errorMessage ? (
          <pre className="mt-1 whitespace-pre-wrap break-words text-red-400">
            {run.errorMessage}
          </pre>
        ) : null}
      </td>
    </tr>
  );
}

/**
 * Renders the JSON summary as a compact one-liner with the columns that
 * actually matter for each job, so the operator doesn't have to expand
 * raw JSON to spot a regression.
 */
function summariseRun(run: CronRun): string {
  const s = run.summary as Record<string, unknown>;
  if (run.job === "classify") {
    const tokens = (s["tokens"] as { total?: number } | undefined)?.total ?? 0;
    return `processed=${s["processed"] ?? 0}  classified=${s["classified"] ?? 0}  failed=${s["failed"] ?? 0}  timedOut=${s["timedOut"] ?? 0}  budgetExhausted=${s["budgetExhausted"] ?? false}  tokens=${tokens}`;
  }
  if (run.job === "broadcast") {
    const posted = (s["posted"] as Record<string, number> | undefined) ?? {};
    return `mastodon=${posted["mastodon"] ?? 0}  bluesky=${posted["bluesky"] ?? 0}  telegram=${posted["telegram"] ?? 0}  failed=${s["failed"] ?? 0}  skipped=${s["skipped"] ?? 0}`;
  }
  if (run.job === "newsletter") {
    const dc = (s["digestCounts"] as { es?: number; en?: number } | undefined) ?? {};
    return `attempted=${s["attempted"] ?? 0}  sent=${s["sent"] ?? 0}  failed=${s["failed"] ?? 0}  skippedNoArticles=${s["skippedNoArticles"] ?? 0}  budgetExhausted=${s["budgetExhausted"] ?? 0}  articles[es=${dc.es ?? 0},en=${dc.en ?? 0}]`;
  }
  // ingest
  const totals = (s["totals"] as Record<string, unknown> | undefined) ?? {};
  return `fetched=${totals["fetched"] ?? 0}  inserted=${totals["inserted"] ?? 0}  failedSources=${totals["failedSources"] ?? 0}`;
}
