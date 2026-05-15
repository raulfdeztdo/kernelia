import Link from "next/link";
import {
  getArticleStatusCounts,
  getCategoryBreakdown,
  getSourceBreakdown,
  getTokensPerDay,
} from "@/db/queries/admin-metrics";
import { CRON_SCHEDULE } from "@/lib/cron-schedule";

export const dynamic = "force-dynamic";

/**
 * Admin dashboard. Server component that fans out 4 metric queries in
 * parallel and renders them as plain HTML cards / tables. No client JS.
 *
 * Heavier interactive views (cron monitor table with filters, article
 * management, user management) live in their own pages.
 */
export default async function AdminDashboardPage() {
  const [statusCounts, byCategory, bySource, tokensPerDay] = await Promise.all([
    getArticleStatusCounts(),
    getCategoryBreakdown(),
    getSourceBreakdown(),
    getTokensPerDay(7),
  ]);

  const totalTokensLast7 = tokensPerDay.reduce((acc, r) => acc + r.totalTokens, 0);

  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Panel de administración</h1>
        <p className="text-sm text-muted-foreground">
          Métricas en vivo de Kernelia. Lectura directa de Supabase, sin caché.
        </p>
      </header>

      <section aria-labelledby="totals-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="totals-heading" className="text-lg font-medium">
            Artículos por estado
          </h2>
          <Link
            href="/admin/articles"
            className="text-sm text-accent underline-offset-2 hover:underline"
          >
            Gestionar artículos →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Total" value={statusCounts.total} />
          <Stat label="Classified" value={statusCounts.classified} tone="accent" />
          <Stat label="Pending" value={statusCounts.pending} />
          <Stat label="Failed" value={statusCounts.failed} tone="warn" />
          <Stat label="Hidden" value={statusCounts.hidden} tone="muted" />
        </div>
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

      <section aria-labelledby="sources-heading" className="space-y-3">
        <h2 id="sources-heading" className="text-lg font-medium">
          Por fuente
        </h2>
        <Table
          headers={["Fuente", "Activa", "Total artículos", "Último ingest"]}
          rows={bySource.map((s) => [
            s.name,
            s.active ? "✓" : "—",
            String(s.total),
            s.lastIngestedAt ? formatRelative(s.lastIngestedAt) : "—",
          ])}
        />
      </section>

      <section aria-labelledby="tokens-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="tokens-heading" className="text-lg font-medium">
            Tokens (clasificación, últimos 7 días)
          </h2>
          <span className="text-sm text-muted-foreground">
            Total: <strong className="text-foreground">{totalTokensLast7.toLocaleString()}</strong>
          </span>
        </div>
        <Table
          headers={["Día (UTC)", "Prompt", "Completion", "Total", "Ticks"]}
          rows={tokensPerDay.map((d) => [
            d.date,
            d.promptTokens.toLocaleString(),
            d.completionTokens.toLocaleString(),
            d.totalTokens.toLocaleString(),
            String(d.runs),
          ])}
        />
      </section>

      <section aria-labelledby="users-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="users-heading" className="text-lg font-medium">
            Usuarios
          </h2>
          <Link
            href="/admin/users"
            className="text-sm text-accent underline-offset-2 hover:underline"
          >
            Gestionar usuarios →
          </Link>
        </div>
        <p className="text-sm text-muted-foreground">
          Lista de admins con acceso al backoffice. Añade, desactiva o borra emails.
        </p>
      </section>

      <section aria-labelledby="cron-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="cron-heading" className="text-lg font-medium">
            Cron
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
        </ul>
      </section>
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
              <td className="px-3 py-3 text-muted-foreground" colSpan={headers.length}>
                Sin datos.
              </td>
            </tr>
          ) : (
            rows.map((cells, i) => (
              <tr key={i} className="border-t border-border last:border-b">
                {cells.map((c, j) => (
                  <td key={j} className="px-3 py-2 tabular-nums">
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
