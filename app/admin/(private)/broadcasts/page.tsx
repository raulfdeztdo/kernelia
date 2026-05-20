import Link from "next/link";
import {
  BROADCAST_PLATFORMS,
  getBroadcastTotals,
  getBroadcastsPerDay,
  listAdminBroadcastsByArticle,
  type BroadcastPlatformValue,
} from "@/db/queries/admin-broadcasts";
import { listSubscribersWithStats } from "@/db/queries/newsletter-sends";
import { BroadcastsStackedBarChart } from "@/components/admin/charts";

export const dynamic = "force-dynamic";

const PLATFORM_LABEL: Record<BroadcastPlatformValue, string> = {
  mastodon: "Mastodon",
  bluesky: "Bluesky",
  telegram: "Telegram",
};

const isPlatform = (v: unknown): v is BroadcastPlatformValue =>
  v === "mastodon" || v === "bluesky" || v === "telegram";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Admin broadcasts page. Three sections, fanned out via `Promise.all`:
 *
 *   1. Totals per platform (last 7d / 30d / all-time + last-posted).
 *   2. Stacked bar chart of posts/platform/day (30d).
 *   3. Recent broadcasts table joined with the article, filterable by
 *      platform via `?platform=mastodon|bluesky|telegram`.
 */
const PAGE_SIZE = 10;

function parsePage(raw: unknown): number {
  if (typeof raw !== "string") return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  // Cap to a sane upper bound: with PAGE_SIZE = 10 this caps at 10k
  // articles which is well past the broadcaster's expected lifetime
  // backlog. Prevents `?page=99999999` from issuing a giant OFFSET.
  return Math.min(n, 1000);
}

export default async function AdminBroadcastsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const platformFilter = isPlatform(sp.platform) ? sp.platform : undefined;
  const page = parsePage(sp.page);

  const [totals, perDay, recent, subscribers] = await Promise.all([
    getBroadcastTotals(),
    getBroadcastsPerDay(30),
    listAdminBroadcastsByArticle({
      platform: platformFilter,
      pageSize: PAGE_SIZE,
      page,
    }),
    listSubscribersWithStats(),
  ]);

  const total30 = perDay.reduce((acc, r) => acc + r.total, 0);
  const totalPages = Math.max(1, Math.ceil(recent.total / PAGE_SIZE));
  const pageDisplay = Math.min(page + 1, totalPages);

  return (
    <div className="space-y-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Broadcasts</h1>
          <p className="text-sm text-muted-foreground">
            Publicaciones del broadcaster en cada red. Idempotencia por (artículo, plataforma).
          </p>
        </div>
        <Link href="/admin" className="text-sm text-accent underline-offset-2 hover:underline">
          ← Panel
        </Link>
      </header>

      <section aria-labelledby="totals-heading" className="space-y-3">
        <h2 id="totals-heading" className="text-lg font-medium">
          Totales por plataforma
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {totals.map((row) => (
            <div
              key={row.platform}
              className="rounded-md border border-border bg-surface p-4"
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-sm font-medium">{PLATFORM_LABEL[row.platform]}</h3>
                <span className="text-xs text-muted-foreground">
                  {row.lastPostedAt
                    ? `último: ${formatRelative(row.lastPostedAt)}`
                    : "sin publicaciones"}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                <Cell label="7d" value={row.last7d} tone="accent" />
                <Cell label="30d" value={row.last30d} />
                <Cell label="total" value={row.allTime} tone="muted" />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="chart-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="chart-heading" className="text-lg font-medium">
            Volumen diario (30d)
          </h2>
          <span className="text-xs text-muted-foreground">
            Total 30d: {total30.toLocaleString()}
          </span>
        </div>
        <div className="rounded-md border border-border bg-surface p-4">
          <BroadcastsStackedBarChart data={perDay} />
        </div>
      </section>

      <section aria-labelledby="recent-heading" className="space-y-3">
        <h2 id="recent-heading" className="text-lg font-medium">
          Últimos posts
        </h2>
        <FilterBar platform={platformFilter} />
        {/*
         * Phase 8.J: pivoted view. One row per article; each platform
         * column carries its own posted-at + external-id pair. Far less
         * scanning than the old (article × platform) layout where a
         * tri-broadcast article fanned out to three rows.
         */}
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Artículo</th>
                <th className="px-3 py-2 font-medium">Categoría</th>
                <th className="px-3 py-2 font-medium">Score</th>
                {BROADCAST_PLATFORMS.map((p) => (
                  <th key={p} className="px-3 py-2 font-medium">
                    {PLATFORM_LABEL[p]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.rows.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-muted-foreground" colSpan={6}>
                    Sin posts que coincidan con el filtro.
                  </td>
                </tr>
              ) : (
                recent.rows.map((row) => (
                  <tr
                    key={row.articleId}
                    className="border-t border-border align-top last:border-b"
                  >
                    <td className="px-3 py-2 md:max-w-[360px]">
                      <a
                        href={row.articleUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium underline-offset-2 hover:text-accent hover:underline md:line-clamp-2"
                      >
                        {row.articleTitle}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {row.categorySlug ? (
                        <code className="text-xs">{row.categorySlug}</code>
                      ) : (
                        <span>{"—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">
                      {row.relevanceScore != null ? (
                        row.relevanceScore.toFixed(2)
                      ) : (
                        <span>{"—"}</span>
                      )}
                    </td>
                    {BROADCAST_PLATFORMS.map((platform) => {
                      const cell = row.cells[platform];
                      return (
                        <td key={platform} className="px-3 py-2 align-top">
                          <PlatformCell cell={cell} />
                        </td>
                      );
                    })}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <Pager
          page={page}
          totalPages={totalPages}
          pageDisplay={pageDisplay}
          total={recent.total}
          platform={platformFilter}
        />
      </section>

      <SubscribersSection subscribers={subscribers} />
    </div>
  );
}

function SubscribersSection({
  subscribers,
}: {
  subscribers: Awaited<ReturnType<typeof listSubscribersWithStats>>;
}) {
  const active = subscribers.filter((s) => s.confirmedAt && !s.unsubscribedAt).length;
  const pending = subscribers.filter((s) => !s.confirmedAt && !s.unsubscribedAt).length;
  const unsubscribed = subscribers.filter((s) => s.unsubscribedAt).length;

  return (
    <section aria-labelledby="subs-heading" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 id="subs-heading" className="text-lg font-medium">
          Suscriptores de la newsletter
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {active} activos · {pending} pendientes · {unsubscribed} baja
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Idioma</th>
              <th className="px-3 py-2 font-medium">Estado</th>
              <th className="px-3 py-2 font-medium">Categorías</th>
              <th className="px-3 py-2 font-medium">Envios</th>
              <th className="px-3 py-2 font-medium">Ultimo envio</th>
              <th className="px-3 py-2 font-medium">Aperturas</th>
              <th className="px-3 py-2 font-medium">Ultima apertura</th>
              <th className="px-3 py-2 font-medium">Alta / Baja</th>
            </tr>
          </thead>
          <tbody>
            {subscribers.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-muted-foreground">
                  Aun no hay suscriptores.
                </td>
              </tr>
            ) : (
              subscribers.map((s) => <SubscriberRow key={s.id} sub={s} />)
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Las aperturas se cuentan via un pixel 1x1 en el correo. Apple Mail
        Privacy y otros clientes que pre-cargan imagenes inflan el numero —
        tomalo como senal directional, no como deliverability gate.
      </p>
    </section>
  );
}

type SubscriberStatusTone = "active" | "pending" | "unsubscribed";

function subscriberStatus(sub: {
  confirmedAt: Date | null;
  unsubscribedAt: Date | null;
}): { label: string; tone: SubscriberStatusTone } {
  if (sub.unsubscribedAt) return { label: "Baja", tone: "unsubscribed" };
  if (sub.confirmedAt) return { label: "Activo", tone: "active" };
  return { label: "Pendiente", tone: "pending" };
}

const SUB_TONE_CLASS: Record<SubscriberStatusTone, string> = {
  active: "text-accent",
  pending: "text-amber-400",
  unsubscribed: "text-muted-foreground",
};

function formatStamp(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16);
}

function SubscriberRow({
  sub,
}: {
  sub: Awaited<ReturnType<typeof listSubscribersWithStats>>[number];
}) {
  const status = subscriberStatus(sub);
  return (
    <tr className="border-t border-border align-top last:border-b">
      <td className="px-3 py-2 break-all">{sub.email}</td>
      <td className="px-3 py-2 uppercase tracking-wide text-muted-foreground">{sub.locale}</td>
      <td className={`px-3 py-2 font-medium ${SUB_TONE_CLASS[status.tone]}`}>{status.label}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        {sub.preferredCategories.length === 0 ? (
          <span className="italic">Todas</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {sub.preferredCategories.map((slug) => (
              <code
                key={slug}
                className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px]"
              >
                {slug}
              </code>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 py-2 tabular-nums">{sub.sentCount}</td>
      <td className="px-3 py-2 tabular-nums text-muted-foreground">
        {formatStamp(sub.lastSentAt)}
      </td>
      <td className="px-3 py-2 tabular-nums">{sub.openedCount}</td>
      <td className="px-3 py-2 tabular-nums text-muted-foreground">
        {formatStamp(sub.lastOpenedAt)}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">
        <div>Alta: {formatStamp(sub.createdAt)}</div>
        {sub.unsubscribedAt ? <div>Baja: {formatStamp(sub.unsubscribedAt)}</div> : null}
      </td>
    </tr>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "accent" | "muted";
}) {
  const toneClass =
    tone === "accent"
      ? "text-accent"
      : tone === "muted"
        ? "text-muted-foreground"
        : "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-lg font-semibold tabular-nums ${toneClass}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function PlatformCell({
  cell,
}: {
  cell:
    | {
        postedAt: Date;
        externalId: string | null;
      }
    | null;
}) {
  if (!cell) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="space-y-1">
      <time
        dateTime={cell.postedAt.toISOString()}
        className="block whitespace-nowrap text-xs tabular-nums text-muted-foreground"
      >
        {cell.postedAt.toISOString().replace("T", " ").slice(0, 16)}
      </time>
      {cell.externalId ? (
        <code className="block break-all text-[10px] text-muted-foreground">
          {cell.externalId}
        </code>
      ) : (
        <span className="block text-[10px] text-muted-foreground italic">
          sin external_id
        </span>
      )}
    </div>
  );
}

function Pager({
  page,
  totalPages,
  pageDisplay,
  total,
  platform,
}: {
  page: number;
  totalPages: number;
  pageDisplay: number;
  total: number;
  platform?: BroadcastPlatformValue;
}) {
  // Plain GET-link pagination: keeps the page server-renderable, no
  // client JS, no scroll restoration bugs. The `?platform=` filter is
  // preserved across page transitions so the operator doesn't lose
  // their context when paging through (e.g.) Mastodon-only history.
  const buildHref = (target: number) => {
    const params = new URLSearchParams();
    if (platform) params.set("platform", platform);
    if (target > 0) params.set("page", String(target));
    const qs = params.toString();
    return qs ? `/admin/broadcasts?${qs}` : "/admin/broadcasts";
  };
  const prevHref = page > 0 ? buildHref(page - 1) : null;
  const nextHref = page + 1 < totalPages ? buildHref(page + 1) : null;
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-xs text-muted-foreground tabular-nums">
        Página {pageDisplay} de {totalPages} · {total.toLocaleString()} artículos
      </span>
      <div className="flex gap-2">
        {prevHref ? (
          <Link
            href={prevHref}
            className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2"
          >
            ← Anterior
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1.5 text-muted-foreground opacity-50">
            ← Anterior
          </span>
        )}
        {nextHref ? (
          <Link
            href={nextHref}
            className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2"
          >
            Siguiente →
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1.5 text-muted-foreground opacity-50">
            Siguiente →
          </span>
        )}
      </div>
    </div>
  );
}

function FilterBar({ platform }: { platform?: BroadcastPlatformValue }) {
  return (
    <form action="/admin/broadcasts" method="get" className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-xs">
        <span className="block uppercase tracking-wide text-muted-foreground">Plataforma</span>
        <select
          name="platform"
          defaultValue={platform ?? ""}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">Todas</option>
          <option value="mastodon">Mastodon</option>
          <option value="bluesky">Bluesky</option>
          <option value="telegram">Telegram</option>
        </select>
      </label>
      <button
        type="submit"
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Filtrar
      </button>
      <Link
        href="/admin/broadcasts"
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
      >
        Limpiar
      </Link>
    </form>
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
