"use client";

import { useCallback, useState } from "react";
import type { CronJob, CronRun, CronRunStatus } from "@/db/schema";
import type { CronRunArticle } from "@/db/queries/articles";
import type { CronRunBroadcast } from "@/db/queries/article-broadcasts";

/**
 * Expandable row for /admin/cron. The server pre-renders the
 * collapsed cells (timestamps, status, one-line summary); when the
 * operator clicks the row we lazily fetch
 * `/api/admin/cron/[id]/details` and show a per-job detail panel:
 *
 *   - ingest/classify → table of articles touched by this tick.
 *   - broadcast       → table of (article, platform) posts.
 *   - newsletter      → placeholder pointing to PR 4.
 *
 * Lazy fetch keeps the initial page payload small (50 runs × the
 * detail data could be hundreds of rows). The first click triggers
 * the fetch, subsequent clicks just toggle visibility.
 */

const JOB_LABEL: Record<CronJob, string> = {
  ingest: "Ingest",
  classify: "Classify",
  broadcast: "Broadcast",
  newsletter: "Newsletter",
};
const STATUS_LABEL: Record<CronRunStatus, string> = {
  running: "Ejecutando…",
  ok: "OK",
  partial: "Parcial",
  failed: "Fallido",
};
const STATUS_TONE: Record<CronRunStatus, string> = {
  running: "text-sky-400",
  ok: "text-accent",
  partial: "text-amber-400",
  failed: "text-red-400",
};

interface CronRunRowProps {
  /**
   * Serialised CronRun. The page passes `JSON.parse(JSON.stringify(r))`
   * essentially — Date columns become ISO strings over the
   * server-client boundary.
   */
  run: SerializedCronRun;
  summaryOneLiner: string;
}

export interface SerializedCronRun {
  id: string;
  job: CronJob;
  status: CronRunStatus;
  startedAt: string; // ISO
  finishedAt: string; // ISO
  durationMs: number;
  errorMessage: string | null;
}

interface ArticlesPayload {
  kind: "articles";
  articles: CronRunArticle[];
}

interface BroadcastsPayload {
  kind: "broadcasts";
  broadcasts: CronRunBroadcast[];
}

interface NewsletterPayload {
  kind: "newsletter_pending";
  summary: Record<string, unknown>;
}

type DetailPayload = ArticlesPayload | BroadcastsPayload | NewsletterPayload;

export function CronRunRow({ run, summaryOneLiner }: CronRunRowProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DetailPayload | null>(null);

  const toggle = useCallback(() => {
    setOpen((prev) => !prev);
    // Lazy fetch on first open. Cached for the lifetime of the page —
    // a fresh page load re-runs the query, which is fine because cron
    // ticks finish in seconds.
    if (!data && !loading && !open) {
      setLoading(true);
      setError(null);
      fetch(`/api/admin/cron/${run.id}/details`, { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return (await res.json()) as DetailPayload;
        })
        .then((payload) => {
          setData(payload);
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          setError(message);
        })
        .finally(() => setLoading(false));
    }
  }, [data, loading, open, run.id]);

  return (
    <>
      <tr
        className="cursor-pointer border-t border-border align-top hover:bg-surface-2"
        onClick={toggle}
        aria-expanded={open}
      >
        <td className="px-3 py-2 tabular-nums">
          <span className="mr-2 inline-block w-3 text-muted-foreground">
            {open ? "▾" : "▸"}
          </span>
          <time dateTime={run.startedAt}>
            {run.startedAt.replace("T", " ").slice(0, 19)}
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
          <pre className="whitespace-pre-wrap break-words text-muted-foreground">
            {summaryOneLiner}
          </pre>
          {run.errorMessage ? (
            <pre className="mt-1 whitespace-pre-wrap break-words text-red-400">
              {run.errorMessage}
            </pre>
          ) : null}
        </td>
      </tr>
      {open ? (
        <tr className="border-t border-border bg-background/60">
          <td colSpan={5} className="px-3 py-3">
            {loading ? (
              <p className="text-sm text-muted-foreground">Cargando detalle…</p>
            ) : null}
            {error ? (
              <p className="text-sm text-red-400">
                No se pudo cargar el detalle: {error}
              </p>
            ) : null}
            {data ? <DetailPanel job={run.job} data={data} /> : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DetailPanel({ job, data }: { job: CronJob; data: DetailPayload }) {
  if (data.kind === "articles") {
    return <ArticlesTable rows={data.articles} stage={job === "ingest" ? "ingested" : "classified"} />;
  }
  if (data.kind === "broadcasts") {
    return <BroadcastsTable rows={data.broadcasts} />;
  }
  // newsletter_pending
  return (
    <div className="space-y-2 text-sm">
      <p className="text-muted-foreground">
        El detalle por suscriptor llega en la siguiente entrega (PR 4: lista de
        suscriptores con apertura y bajas). Por ahora el resumen del envio:
      </p>
      <pre className="overflow-x-auto rounded border border-border bg-surface-2 p-2 text-xs">
        {JSON.stringify(data.summary, null, 2)}
      </pre>
    </div>
  );
}

const STATUS_BADGE: Record<string, string> = {
  pending: "text-amber-400",
  classified: "text-accent",
  hidden: "text-muted-foreground",
  failed: "text-red-400",
};

function ArticlesTable({
  rows,
  stage,
}: {
  rows: CronRunArticle[];
  stage: "ingested" | "classified";
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Este tick no toco ningun articulo.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-2 py-1 font-medium">Titulo</th>
            <th className="px-2 py-1 font-medium">Fuente</th>
            <th className="px-2 py-1 font-medium">Categoria</th>
            <th className="px-2 py-1 font-medium">Estado</th>
            <th className="px-2 py-1 font-medium">{stage === "ingested" ? "Ingestado" : "Score"}</th>
            <th className="px-2 py-1 font-medium">Nota</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="px-2 py-1">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-foreground underline-offset-2 hover:underline"
                >
                  {r.title}
                </a>
              </td>
              <td className="px-2 py-1 text-muted-foreground">{r.sourceName}</td>
              <td className="px-2 py-1 text-muted-foreground">{r.categorySlug ?? "—"}</td>
              <td className={`px-2 py-1 font-medium ${STATUS_BADGE[r.status] ?? ""}`}>
                {r.status}
              </td>
              <td className="px-2 py-1 tabular-nums text-muted-foreground">
                {stage === "ingested"
                  ? r.ingestedAt
                    ? new Date(r.ingestedAt).toISOString().replace("T", " ").slice(0, 19)
                    : "—"
                  : r.relevanceScore !== null
                    ? r.relevanceScore.toFixed(2)
                    : "—"}
              </td>
              <td className="px-2 py-1 text-muted-foreground">
                {r.classificationError ?? ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BroadcastsTable({ rows }: { rows: CronRunBroadcast[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Este tick no publico en ninguna plataforma (ventana fuera de horario o sin articulos pendientes).
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-left uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-2 py-1 font-medium">Plataforma</th>
            <th className="px-2 py-1 font-medium">Titulo</th>
            <th className="px-2 py-1 font-medium">Posted (UTC)</th>
            <th className="px-2 py-1 font-medium">External ID</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t border-border align-top">
              <td className="px-2 py-1 font-medium">{r.platform}</td>
              <td className="px-2 py-1">
                <a
                  href={r.articleUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-foreground underline-offset-2 hover:underline"
                >
                  {r.articleTitle}
                </a>
              </td>
              <td className="px-2 py-1 tabular-nums text-muted-foreground">
                {new Date(r.postedAt).toISOString().replace("T", " ").slice(0, 19)}
              </td>
              <td className="px-2 py-1 text-muted-foreground">{r.externalId ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Identical to the legacy server-side summariser in `page.tsx` —
 * exported so the page can keep rendering the one-liner with the same
 * shape it always had.
 */
export function summariseRun(run: CronRun): string {
  const s = run.summary as Record<string, unknown>;
  if (run.job === "classify") {
    const tokens = (s["tokens"] as { total?: number } | undefined)?.total ?? 0;
    return `processed=${s["processed"] ?? 0}  classified=${s["classified"] ?? 0}  dedupedHidden=${s["dedupedHidden"] ?? 0}  dedupedReplaced=${s["dedupedReplaced"] ?? 0}  hiddenNonAi=${s["hiddenNonAi"] ?? 0}  failed=${s["failed"] ?? 0}  timedOut=${s["timedOut"] ?? 0}  budgetExhausted=${s["budgetExhausted"] ?? false}  tokens=${tokens}`;
  }
  if (run.job === "broadcast") {
    if (s["skippedWindow"]) return "skippedWindow=true (fuera de ventana Europe/Madrid)";
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
