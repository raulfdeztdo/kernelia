import Link from "next/link";
import type { ReactNode } from "react";
import {
  getAnalyticsTotals,
  getBreakdown,
  getDailyTraffic,
  getTopArticles,
  listAudienceSnapshotsSince,
  type BreakdownRow,
} from "@/db/queries/analytics";
import type { AudienceChannel } from "@/db/schema";
import { AudienceLineChart, TrafficLineChart } from "@/components/admin/charts";
import { ensureTodayAudienceSnapshot } from "@/lib/analytics/audience";
import {
  RANGE_OPTIONS,
  fillDailySeries,
  madridDaysBetween,
  parseRange,
  percentDelta,
  pivotAudience,
  rangeBounds,
  summarizeAudience,
} from "@/lib/analytics/dashboard";
import { getMadridDate } from "@/lib/broadcast/window";
import { createLogger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const log = createLogger("admin_analytics");

const CHANNEL_LABEL: Record<AudienceChannel, string> = {
  telegram: "Telegram",
  mastodon: "Mastodon",
  bluesky: "Bluesky",
  newsletter: "Newsletter",
};

const CTA_LABEL: Record<string, string> = {
  telegram: "Botón Telegram (home)",
  newsletter: "Newsletter (home, móvil)",
  "header-telegram": "Icono Telegram (cabecera)",
  "header-mastodon": "Icono Mastodon (cabecera)",
  "header-bluesky": "Icono Bluesky (cabecera)",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Phase 9.A — first-party analytics + audience growth.
 *
 * Two questions, in the order the operator asks them:
 *   1. ¿Crece la audiencia? — followers per channel, today vs 7/30 days
 *      ago, and the daily snapshot series.
 *   2. ¿Viene gente a la web y desde dónde? — visits, visitors, clicks
 *      to the source and on our CTAs, plus the breakdowns.
 *
 * Queries run sequentially for the same reason as the dashboard (see the
 * note in `app/admin/(private)/page.tsx`): parallel fan-out against the
 * Supabase pooler intermittently hangs the function.
 */
export default async function AdminAnalyticsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const days = parseRange(sp.range);
  const now = new Date();
  const { from, to, previousFrom } = rangeBounds(days, now);

  // Fallback snapshot for days the cleanup cron hasn't run yet. Slow
  // platform APIs must not break the page, so failures only log.
  try {
    await ensureTodayAudienceSnapshot(now);
  } catch (err) {
    log.warn("snapshot_on_render_failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  /* eslint-disable react-review/async-parallel, react-review/server-sequential-independent-await */
  const snapshots = await listAudienceSnapshotsSince(
    getMadridDate(new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)),
  );
  const totals = await getAnalyticsTotals(from, to);
  const previous = await getAnalyticsTotals(previousFrom, from);
  const daily = await getDailyTraffic(from, to);
  const sources = await getBreakdown("source", from, to);
  const paths = await getBreakdown("path", from, to);
  const articles = await getTopArticles(from, to);
  const ctas = await getBreakdown("cta", from, to);
  const outbound = await getBreakdown("outbound", from, to);
  const countries = await getBreakdown("country", from, to);
  const devices = await getBreakdown("device", from, to);
  /* eslint-enable react-review/async-parallel, react-review/server-sequential-independent-await */

  const audience = summarizeAudience(snapshots, now);
  const audienceSeries = pivotAudience(snapshots);
  const series = fillDailySeries(daily, madridDaysBetween(from, to));
  const pagesPerVisitor = totals.visitors > 0 ? totals.pageviews / totals.visitors : 0;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Analítica</h1>
          <p className="text-muted-foreground text-sm">
            Audiencia por canal y visitas a la web. Sin cookies: los visitantes se cuentan por día.
          </p>
        </div>
        <nav aria-label="Rango" className="border-border flex gap-1 rounded-md border p-1 text-sm">
          {RANGE_OPTIONS.map((r) => (
            <Link
              key={r}
              href={`/admin/analytics?range=${r}`}
              aria-current={r === days ? "page" : undefined}
              className={`rounded px-3 py-1 ${
                r === days
                  ? "bg-surface-2 text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {r} días
            </Link>
          ))}
        </nav>
      </header>

      <section aria-labelledby="audience-heading" className="space-y-3">
        <h2 id="audience-heading" className="text-lg font-medium">
          Audiencia por canal
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {audience.map((a) => (
            <div key={a.channel} className="border-border bg-surface rounded-md border p-3">
              <div className="text-muted-foreground text-xs tracking-wide uppercase">
                {CHANNEL_LABEL[a.channel]}
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {a.current === null ? "—" : a.current.toLocaleString("es-ES")}
              </div>
              <div className="text-muted-foreground mt-1 flex gap-3 text-xs">
                <span>7d {formatChange(a.change7d)}</span>
                <span>30d {formatChange(a.change30d)}</span>
              </div>
            </div>
          ))}
        </div>
        {audienceSeries.length >= 2 ? (
          <ChartCard title="Evolución de seguidores" subtitle="Un punto por día (últimos 90 días).">
            <AudienceLineChart data={audienceSeries} />
          </ChartCard>
        ) : (
          <p className="text-muted-foreground text-sm">
            La gráfica aparecerá cuando haya al menos dos días de lecturas (se toma una al día).
          </p>
        )}
      </section>

      <section aria-labelledby="traffic-heading" className="space-y-3">
        <h2 id="traffic-heading" className="text-lg font-medium">
          Tráfico web · últimos {days} días
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            label="Visitas"
            value={totals.pageviews}
            delta={percentDelta(totals.pageviews, previous.pageviews)}
          />
          <Kpi
            label="Visitantes"
            value={totals.visitors}
            delta={percentDelta(totals.visitors, previous.visitors)}
            hint={`${pagesPerVisitor.toLocaleString("es-ES", { maximumFractionDigits: 1 })} páginas por visitante`}
          />
          <Kpi
            label="Clics a la fuente"
            value={totals.outbound}
            delta={percentDelta(totals.outbound, previous.outbound)}
          />
          <Kpi
            label="Clics en CTAs"
            value={totals.cta}
            delta={percentDelta(totals.cta, previous.cta)}
          />
        </div>
        {totals.pageviews === 0 && previous.pageviews === 0 ? (
          <p className="text-muted-foreground text-sm">
            Aún no hay visitas registradas en este rango. La recogida empieza con el despliegue de
            la Fase 9.A.
          </p>
        ) : (
          <ChartCard title="Visitas por día" subtitle="Hora de Madrid.">
            <TrafficLineChart data={series} />
          </ChartCard>
        )}
      </section>

      <section aria-labelledby="breakdown-heading" className="space-y-3">
        <h2 id="breakdown-heading" className="text-lg font-medium">
          De dónde vienen y qué hacen
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <Breakdown
            title="Origen"
            subtitle="utm_source si el enlace lo trae; si no, el sitio de procedencia."
            rows={sources}
            unit="Visitas"
          />
          <Breakdown title="Páginas" rows={paths} unit="Visitas" />
          <Breakdown
            title="CTAs"
            rows={ctas.map((r) => ({ ...r, label: CTA_LABEL[r.label] ?? r.label }))}
            unit="Clics"
          />
          <Breakdown title="Clics a la fuente (por medio)" rows={outbound} unit="Clics" />
          <Breakdown title="Países" rows={countries} unit="Visitas" />
          <Breakdown title="Dispositivos" rows={devices} unit="Visitas" />
        </div>

        <Card title="Noticias con más interacción">
          {articles.length === 0 ? (
            <Empty />
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left text-xs tracking-wide uppercase">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">Noticia</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Visitas</th>
                  <th className="py-1.5 text-right font-medium">Clics fuente</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((a) => (
                  <tr key={a.articleId} className="border-border border-t">
                    <td className="py-1.5 pr-3">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-accent line-clamp-1 hover:underline"
                      >
                        {a.title}
                      </a>
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{a.pageviews}</td>
                    <td className="py-1.5 text-right tabular-nums">{a.outbound}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>
    </div>
  );
}

function formatChange(change: number | null): string {
  if (change === null) return "—";
  if (change === 0) return "±0";
  return change > 0 ? `+${change}` : String(change);
}

function Kpi({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: number;
  delta: number | null;
  hint?: string;
}) {
  const tone =
    delta === null ? "text-muted-foreground" : delta >= 0 ? "text-emerald-400" : "text-red-400";
  return (
    <div className="border-border bg-surface rounded-md border p-3">
      <div className="text-muted-foreground text-xs tracking-wide uppercase">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">
        {value.toLocaleString("es-ES")}
      </div>
      <div className="mt-1 text-xs">
        <span className={tone}>
          {delta === null
            ? "sin periodo previo"
            : `${delta >= 0 ? "+" : ""}${delta}% vs periodo anterior`}
        </span>
        {hint ? <span className="text-muted-foreground block">{hint}</span> : null}
      </div>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-border bg-surface rounded-md border p-4">
      <div className="mb-2">
        <h3 className="text-sm font-medium">{title}</h3>
        {subtitle ? <p className="text-muted-foreground text-xs">{subtitle}</p> : null}
      </div>
      {children}
    </div>
  );
}

function ChartCard(props: { title: string; subtitle?: string; children: ReactNode }) {
  return <Card {...props} />;
}

function Empty() {
  return <p className="text-muted-foreground py-2 text-sm">Sin datos en este rango.</p>;
}

/** Top-N list with a proportional bar behind each row. */
function Breakdown({
  title,
  subtitle,
  rows,
  unit,
}: {
  title: string;
  subtitle?: string;
  rows: BreakdownRow[];
  unit: string;
}) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <Card title={title} subtitle={subtitle}>
      {rows.length === 0 ? (
        <Empty />
      ) : (
        <ul className="space-y-1 text-sm" aria-label={`${title} (${unit})`}>
          {rows.map((r) => (
            <li
              key={r.label}
              className="relative flex items-center justify-between gap-3 px-2 py-1"
            >
              <span
                aria-hidden
                className="bg-accent/10 absolute inset-y-0 left-0 rounded"
                style={{ width: `${max > 0 ? (r.count / max) * 100 : 0}%` }}
              />
              <span className="relative truncate">{r.label}</span>
              <span className="text-muted-foreground relative shrink-0 tabular-nums">
                {r.count.toLocaleString("es-ES")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
