import type { HealthResult } from "@/lib/health";

interface Props {
  result: HealthResult;
}

/**
 * Pill + small metric grid showing the current state of `/api/health`.
 * Server-rendered: the parent dashboard already has the probe result in
 * hand, so we just paint it. No client JS, no auto-refresh — a page
 * reload re-runs the probe (the layout is `force-dynamic`).
 *
 * On the OK path we surface DB latency (proxied by `uptimeMs`), the last
 * ingest timestamp, and the article counts that come back from the same
 * probe. On the error path we collapse to a single red banner with the
 * reason — that's the only actionable bit for the operator.
 */
export function HealthCard({ result }: Props) {
  if (result.status === "error") {
    return (
      <div
        role="alert"
        className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-red-400" aria-hidden />
          <span className="font-medium text-red-300">503 — health check falló</span>
        </div>
        <p className="mt-2 text-muted-foreground">
          <code className="text-xs">{result.reason}</code>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Probado a las {new Date(result.ts).toISOString().slice(11, 19)} UTC.
        </p>
      </div>
    );
  }

  const tone = latencyTone(result.uptimeMs);

  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
          <span className="font-medium text-emerald-300">200 — healthy</span>
        </div>
        <span className="text-xs text-muted-foreground">
          Probado a las {new Date(result.ts).toISOString().slice(11, 19)} UTC
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Metric
          label="DB latencia"
          value={`${result.uptimeMs} ms`}
          tone={tone}
        />
        <Metric
          label="Último ingest"
          value={result.lastIngestAt ? formatRelative(new Date(result.lastIngestAt)) : "—"}
        />
        <Metric label="Classified" value={result.articles.classified.toLocaleString()} />
        <Metric label="Pending" value={result.articles.pending.toLocaleString()} />
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "warn" | "default";
}) {
  const valueClass = tone === "warn" ? "text-amber-300" : "text-foreground";
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

/**
 * Tag any probe slower than 500ms as `warn`. Supabase's serverless pool +
 * a 3-statement parallel probe is normally under 200ms; >500 suggests cold
 * start or pool exhaustion worth eyeballing.
 */
function latencyTone(ms: number): "warn" | "default" {
  return ms >= 500 ? "warn" : "default";
}

function formatRelative(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "hace <1 min";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return d.toISOString().slice(0, 10);
}
