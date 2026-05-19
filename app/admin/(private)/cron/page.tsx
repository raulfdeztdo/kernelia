import Link from "next/link";
import { listCronRuns } from "@/db/queries/cron-runs";
import type { CronJob, CronRunStatus } from "@/db/schema";
import { CronDispatchButtons } from "@/components/admin/cron-dispatch-buttons";
import { CronRunRow } from "@/components/admin/cron-run-row";
import { summariseRun } from "@/lib/admin/cron-run-summary";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const isJob = (v: unknown): v is CronJob =>
  v === "ingest" ||
  v === "classify" ||
  v === "broadcast" ||
  v === "newsletter" ||
  v === "cleanup";
const isStatus = (v: unknown): v is CronRunStatus =>
  v === "running" || v === "ok" || v === "partial" || v === "failed";

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

      <CronDispatchButtons />

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
              runs.map((r) => (
                <CronRunRow
                  key={r.id}
                  run={{
                    id: r.id,
                    job: r.job,
                    status: r.status,
                    startedAt: r.startedAt.toISOString(),
                    finishedAt: r.finishedAt.toISOString(),
                    durationMs: r.durationMs,
                    errorMessage: r.errorMessage,
                  }}
                  summaryOneLiner={summariseRun(r)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Mostrando las 50 ejecuciones más recientes. Haz clic en una fila para ver
        el detalle: noticias ingestadas/clasificadas o posts enviados por ese
        tick. Las anteriores se mantienen en la tabla{" "}
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
          <option value="cleanup">Cleanup</option>
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
          <option value="running">Ejecutando</option>
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
