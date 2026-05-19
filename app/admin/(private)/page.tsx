// Admin dashboard — metrics, charts, health card, cron schedule.
import Link from "next/link";
import {
  getArticleStatusCounts,
  getCategoryBreakdown,
  getClassifiedPerDay,
  getSourceBreakdown,
  getSourceVolume,
  getTokensPerDay,
} from "@/db/queries/admin-metrics";
import {
  getBroadcastsPerDay,
  getBroadcastTotals,
} from "@/db/queries/admin-broadcasts";
import { getNewsletterCounts } from "@/db/queries/newsletter";
import { CRON_SCHEDULE } from "@/lib/cron-schedule";
import { probeHealth } from "@/lib/health";
import { HealthCard } from "@/components/admin/health-card";
import {
  BroadcastsStackedBarChart,
  ClassifiedLineChart,
  SourcesBarChart,
  StatusDonut,
  TokensBarChart,
} from "@/components/admin/charts";

export const dynamic = "force-dynamic";

/**
 * Admin dashboard. Server component that fans out the metric queries +
 * the health probe in parallel, then renders charts (client islands via
 * Recharts) alongside the supporting tables.
 *
 * Phase 7.H layout:
 *   - Health card.
 *   - Status section: 5-up Stat grid (numbers) + donut (visual). Side by
 *     side on desktop, stacked on mobile.
 *   - Tokens & classified per day, last 30d: two charts side by side.
 *   - Volume per source, last 30d: horizontal bar of top-10 + the full
 *     source table below as drill-down (last-ingest column matters).
 *   - Categories: table (no chart — 10 fixed slugs are easier to scan
 *     in tabular form).
 *   - Cron schedule reminder.
 *
 * Charts are kept in `components/admin/charts/*` and are all "use client"
 * because Recharts touches the DOM. The dashboard stays a server component
 * so the metric queries run in one network hop.
 */
export default async function AdminDashboardPage() {
  // Sequential, not Promise.all. With 10+ parallel queries against Supabase
  // pgbouncer (transaction mode, `prepare: false`), Vercel's serverless
  // function intermittently hangs past the 60s cap → 504. Reproduced
  // locally as well: same 10 queries took ~660ms in parallel on one run
  // and never resolved on the next. Serial total is ~1.5s locally, well
  // inside the platform cap, with zero pool contention. Plenty of
  // headroom for a dashboard that's hit rarely. The `server-sequential-
  // independent-await` and `async-parallel` warnings React Review fires
  // on each line below are deliberate — disabling per-line to keep the
  // intent local instead of hiding the rule globally.
  /* eslint-disable react-review/async-parallel, react-review/server-sequential-independent-await */
  const health = await probeHealth();
  const statusCounts = await getArticleStatusCounts();
  const byCategory = await getCategoryBreakdown();
  const bySource = await getSourceBreakdown();
  const tokensPerDay30 = await getTokensPerDay(30);
  const classifiedPerDay30 = await getClassifiedPerDay(30);
  const sourceVolume = await getSourceVolume({ days: 30, topN: 10 });
  const broadcastsPerDay30 = await getBroadcastsPerDay(30);
  const broadcastTotals = await getBroadcastTotals();
  const newsletterCounts = await getNewsletterCounts();
  /* eslint-enable react-review/async-parallel, react-review/server-sequential-independent-await */

  const totalTokensLast30 = tokensPerDay30.reduce((acc, r) => acc + r.totalTokens, 0);
  const totalClassifiedLast30 = classifiedPerDay30.reduce((acc, r) => acc + r.classified, 0);
  const totalBroadcastsLast30 = broadcastsPerDay30.reduce((acc, r) => acc + r.total, 0);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Panel de administración</h1>
        <p className="text-sm text-muted-foreground">
          Métricas en vivo de Kernelia. Lectura directa de Supabase, sin caché.
        </p>
      </header>

      <section aria-labelledby="health-heading" className="space-y-3">
        <h2 id="health-heading" className="text-lg font-medium">
          Estado del servicio
        </h2>
        <HealthCard result={health} />
      </section>

      <section aria-labelledby="status-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="status-heading" className="text-lg font-medium">
            Artículos por estado
          </h2>
          <Link
            href="/admin/articles"
            className="text-sm text-accent underline-offset-2 hover:underline"
          >
            Gestionar artículos →
          </Link>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="grid grid-cols-2 gap-3 self-start sm:grid-cols-3 lg:grid-cols-2">
            <Stat label="Total" value={statusCounts.total} />
            <Stat label="Classified" value={statusCounts.classified} tone="accent" />
            <Stat label="Pending" value={statusCounts.pending} />
            <Stat label="Failed" value={statusCounts.failed} tone="warn" />
            <Stat label="Hidden" value={statusCounts.hidden} tone="muted" />
          </div>
          <div className="rounded-md border border-border bg-surface p-3">
            <StatusDonut
              classified={statusCounts.classified}
              pending={statusCounts.pending}
              failed={statusCounts.failed}
              hidden={statusCounts.hidden}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="output-heading" className="space-y-3">
        <h2 id="output-heading" className="text-lg font-medium">
          Output del cron (últimos 30 días)
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Tokens consumidos"
            subtitle={`Total: ${totalTokensLast30.toLocaleString()}`}
          >
            <TokensBarChart data={tokensPerDay30} />
          </ChartCard>
          <ChartCard
            title="Artículos clasificados"
            subtitle={`Total: ${totalClassifiedLast30.toLocaleString()}`}
          >
            <ClassifiedLineChart data={classifiedPerDay30} />
          </ChartCard>
        </div>
      </section>

      <section aria-labelledby="sources-heading" className="space-y-3">
        <h2 id="sources-heading" className="text-lg font-medium">
          Volumen por fuente
        </h2>
        <ChartCard
          title="Top fuentes (clasificados, últimos 30d)"
          subtitle="Detecta qué feeds dominan el flujo y cuáles se han quedado en silencio."
        >
          <SourcesBarChart data={sourceVolume} />
        </ChartCard>
        <details className="rounded-md border border-border bg-surface text-sm">
          <summary className="cursor-pointer select-none px-4 py-2 font-medium text-muted-foreground hover:text-foreground">
            Todas las fuentes (último ingest)
          </summary>
          <Table
            headers={["Fuente", "Activa", "Total artículos", "Último ingest"]}
            rows={bySource.map((s) => [
              s.name,
              s.active ? "✓" : "—",
              String(s.total),
              s.lastIngestedAt ? formatRelative(s.lastIngestedAt) : "—",
            ])}
          />
        </details>
      </section>

      <section aria-labelledby="cats-heading" className="space-y-3">
        <h2 id="cats-heading" className="text-lg font-medium">
          Por categoría
        </h2>
        <Table
          headers={["Slug", "Nombre (ES)", "Classified", "Hidden", "Pending", "Failed", "Total"]}
          rows={byCategory.map((c) => [
            <code key="slug" className="text-xs">
              {c.slug}
            </code>,
            c.nameEs,
            String(c.classified),
            String(c.hidden),
            String(c.pending),
            String(c.failed),
            String(c.total),
          ])}
        />
      </section>

      <section aria-labelledby="distribution-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="distribution-heading" className="text-lg font-medium">
            Distribución
          </h2>
          <Link
            href="/admin/broadcasts"
            className="text-sm text-accent underline-offset-2 hover:underline"
          >
            Ver detalle →
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {broadcastTotals.map((row) => (
            <div key={row.platform} className="rounded-md border border-border bg-surface p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {row.platform}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-semibold tabular-nums text-foreground">
                  {row.last30d.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground">posts / 30d</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                7d: {row.last7d} · total: {row.allTime}
              </div>
            </div>
          ))}
        </div>
        <ChartCard
          title="Posts por día (30d)"
          subtitle={`Total: ${totalBroadcastsLast30.toLocaleString()}`}
        >
          <BroadcastsStackedBarChart data={broadcastsPerDay30} />
        </ChartCard>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Suscriptores activos" value={newsletterCounts.confirmed} tone="accent" />
          <Stat label="Pendientes" value={newsletterCounts.pending} />
          <Stat label="Bajas" value={newsletterCounts.unsubscribed} tone="muted" />
          <Stat label="Total filas" value={newsletterCounts.total} tone="muted" />
        </div>
      </section>

      <section aria-labelledby="cron-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="cron-heading" className="text-lg font-medium">
            Schedule del cron
          </h2>
          <Link
            href="/admin/cron"
            className="text-sm text-accent underline-offset-2 hover:underline"
          >
            Ver últimas ejecuciones →
          </Link>
        </div>
        <ul className="space-y-1 rounded-md border border-border bg-surface p-4 text-sm">
          <li>
            <strong>Ingest</strong>: <code>{CRON_SCHEDULE.ingest.cron}</code> ·{" "}
            <span className="text-muted-foreground">{CRON_SCHEDULE.ingest.description}</span>
          </li>
          <li>
            <strong>Classify</strong>: <code>{CRON_SCHEDULE.classify.cron}</code> ·{" "}
            <span className="text-muted-foreground">{CRON_SCHEDULE.classify.description}</span>
          </li>
          <li>
            <strong>Broadcast</strong>: <code>{CRON_SCHEDULE.broadcast.cron}</code> ·{" "}
            <span className="text-muted-foreground">{CRON_SCHEDULE.broadcast.description}</span>
          </li>
          <li>
            <strong>Newsletter</strong>: <code>{CRON_SCHEDULE.newsletter.cron}</code> ·{" "}
            <span className="text-muted-foreground">{CRON_SCHEDULE.newsletter.description}</span>
          </li>
        </ul>
      </section>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {subtitle ? <span className="text-xs text-muted-foreground">{subtitle}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "accent" | "warn" | "muted";
}) {
  const accentClass =
    tone === "accent"
      ? "text-accent"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accentClass}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="p-3 text-muted-foreground" colSpan={headers.length}>
                Sin datos.
              </td>
            </tr>
          ) : (
            rows.map((cells, rowIndex) => (
              // The categories table is render-only with no add/remove or
              // sort; index-as-key is safe here.
              <tr key={`cat-row-${rowIndex}`} className="border-t border-border last:border-b">
                {cells.map((c, colIndex) => (
                  <td key={`cat-cell-${rowIndex}-${colIndex}`} className="px-3 py-2 tabular-nums">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
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
