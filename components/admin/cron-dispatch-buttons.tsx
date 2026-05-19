"use client";

import { useState } from "react";
import { CRON_DISPATCH_JOBS, type CronDispatchJob } from "@/lib/github/dispatch";

const JOB_LABEL: Record<CronDispatchJob, string> = {
  ingest: "Ingest",
  classify: "Classify",
  broadcast: "Broadcast",
  newsletter: "Newsletter",
};

type Status =
  | { kind: "idle" }
  | { kind: "loading"; job: CronDispatchJob }
  | { kind: "ok"; job: CronDispatchJob; runsUrl: string | null }
  | { kind: "error"; job: CronDispatchJob; message: string };

/**
 * One button per cron job. On click, POSTs to
 * `/api/admin/cron/dispatch` which talks to GitHub's
 * `workflow_dispatch` API for `cron.yml`. Provides a small status line
 * underneath so the operator gets immediate feedback (GitHub returns a
 * 204 with no run id, so we link to the Actions tab instead).
 */
export function CronDispatchButtons() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function trigger(job: CronDispatchJob) {
    setStatus({ kind: "loading", job });
    try {
      const res = await fetch("/api/admin/cron/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; runsUrl?: string | null; error?: string; message?: string; missingEnv?: string }
        | null;
      if (res.ok && body?.ok) {
        setStatus({ kind: "ok", job, runsUrl: body.runsUrl ?? null });
        return;
      }
      // Map common error shapes to a human-readable message.
      let message = "Error desconocido";
      if (body?.error === "config" && body.missingEnv) {
        message = `Falta configurar la variable ${body.missingEnv} en Vercel`;
      } else if (body?.error === "github" && body.message) {
        message = `GitHub: ${body.message}`;
      } else if (body?.error === "unauthorized") {
        message = "Sesión caducada — recarga la página";
      } else if (body?.error === "forbidden") {
        message = "Tu usuario no es admin";
      } else if (res.status === 400) {
        message = "Petición inválida";
      } else if (body?.message) {
        message = body.message;
      }
      setStatus({ kind: "error", job, message });
    } catch (err) {
      setStatus({
        kind: "error",
        job,
        message: err instanceof Error ? err.message : "Network error",
      });
    }
  }

  return (
    <section className="space-y-3 rounded-md border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Lanzar manualmente
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Dispara el workflow <code>cron.yml</code> en GitHub Actions con el job
          elegido. Tarda unos segundos en aparecer la ejecución en la pestaña
          Actions del repo.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {CRON_DISPATCH_JOBS.map((job) => {
          const isLoading = status.kind === "loading" && status.job === job;
          return (
            <button
              key={job}
              type="button"
              onClick={() => trigger(job)}
              disabled={isLoading || status.kind === "loading"}
              aria-busy={isLoading}
              className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium transition hover:border-border-strong hover:bg-surface disabled:cursor-progress disabled:opacity-60"
            >
              {isLoading ? `Lanzando ${JOB_LABEL[job]}…` : JOB_LABEL[job]}
            </button>
          );
        })}
      </div>
      <StatusLine status={status} />
    </section>
  );
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle" || status.kind === "loading") return null;
  if (status.kind === "ok") {
    return (
      <p className="text-xs text-accent" role="status">
        ✓ {JOB_LABEL[status.job]} lanzado correctamente.{" "}
        {status.runsUrl ? (
          <a
            href={status.runsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-2 hover:underline"
          >
            Ver en GitHub Actions ↗
          </a>
        ) : null}
      </p>
    );
  }
  return (
    <p className="text-xs text-red-400" role="alert">
      ✕ {JOB_LABEL[status.job]} no lanzó: {status.message}
    </p>
  );
}
