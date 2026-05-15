import Link from "next/link";
import { listAdminArticles } from "@/db/queries/admin-articles";
import { listCategories } from "@/db/queries/categories";
import { listSourcesForAdmin } from "@/db/queries/sources";
import { articleStatusEnum, type ArticleStatus } from "@/db/schema";
import { ArticleRowActions } from "@/components/admin/article-row-actions";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<ArticleStatus, string> = {
  pending: "bg-surface-2 text-muted-foreground",
  classified: "bg-accent/15 text-accent",
  failed: "bg-red-500/15 text-red-300",
  hidden: "bg-amber-500/15 text-amber-300",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function isStatus(v: unknown): v is ArticleStatus {
  return typeof v === "string" && (articleStatusEnum.enumValues as readonly string[]).includes(v);
}

export default async function AdminArticlesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const statusFilter = isStatus(sp.status) ? sp.status : undefined;
  const categoryFilter = typeof sp.category === "string" && sp.category ? sp.category : undefined;
  const sourceFilter = typeof sp.source === "string" && sp.source ? sp.source : undefined;

  // Cursor encoded as `<isoTimestamp>|<id>`. Tolerant: any malformed cursor
  // is silently dropped (falls back to page 1).
  const cursor = parseCursor(typeof sp.cursor === "string" ? sp.cursor : undefined);

  const [page, allCategories, allSources] = await Promise.all([
    listAdminArticles({
      status: statusFilter,
      categoryId: categoryFilter,
      sourceId: sourceFilter,
      cursor,
      limit: 50,
    }),
    listCategories(),
    listSourcesForAdmin(),
  ]);

  const categoryOptions = allCategories.map((c) => ({ id: c.id, slug: c.slug, nameEs: c.nameEs }));

  return (
    <div className="space-y-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">Artículos</h1>
        <Link href="/admin" className="text-sm text-accent underline-offset-2 hover:underline">
          ← Panel
        </Link>
      </header>

      <form action="/admin/articles" method="get" className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-xs">
          <span className="block uppercase tracking-wide text-muted-foreground">Status</span>
          <select
            name="status"
            defaultValue={statusFilter ?? ""}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Todos</option>
            {articleStatusEnum.enumValues.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="block uppercase tracking-wide text-muted-foreground">Categoría</span>
          <select
            name="category"
            defaultValue={categoryFilter ?? ""}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Todas</option>
            {allCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameEs}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-xs">
          <span className="block uppercase tracking-wide text-muted-foreground">Fuente</span>
          <select
            name="source"
            defaultValue={sourceFilter ?? ""}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Todas</option>
            {allSources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Filtrar
        </button>
        <Link
          href="/admin/articles"
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface-2"
        >
          Limpiar
        </Link>
      </form>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Título</th>
              <th className="px-3 py-2 font-medium">Fuente</th>
              <th className="px-3 py-2 font-medium">Categoría</th>
              <th className="px-3 py-2 font-medium">Publicado</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {page.rows.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-muted-foreground" colSpan={6}>
                  Sin artículos que coincidan con los filtros.
                </td>
              </tr>
            ) : (
              page.rows.map((row) => (
                <tr key={row.id} className="border-t border-border align-top last:border-b">
                  <td className="max-w-[320px] px-3 py-2">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      className="line-clamp-2 underline-offset-2 hover:underline"
                    >
                      {row.title}
                    </a>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {row.sourceName}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {row.categoryNameEs ?? "—"}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums text-muted-foreground">
                    {row.publishedAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[row.status]}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <ArticleRowActions
                      articleId={row.id}
                      currentStatus={row.status}
                      currentCategoryId={row.categoryId}
                      canBeClassified={row.hasAllClassifyColumns}
                      categories={categoryOptions}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <nav className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          Mostrando {page.rows.length} {page.rows.length === 1 ? "artículo" : "artículos"}.
        </span>
        {page.nextCursor ? (
          <Link
            href={buildNextHref(sp, page.nextCursor)}
            className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2"
          >
            Siguiente →
          </Link>
        ) : null}
      </nav>
    </div>
  );
}

function parseCursor(raw: string | undefined): { publishedAt: Date; id: string } | undefined {
  if (!raw) return undefined;
  const idx = raw.indexOf("|");
  if (idx <= 0) return undefined;
  const iso = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  const d = new Date(iso);
  if (Number.isNaN(d.getTime()) || !id) return undefined;
  return { publishedAt: d, id };
}

function buildNextHref(
  sp: Record<string, string | string[] | undefined>,
  cursor: { publishedAt: Date; id: string },
): string {
  const params = new URLSearchParams();
  for (const key of ["status", "category", "source"] as const) {
    const v = sp[key];
    if (typeof v === "string" && v) params.set(key, v);
  }
  params.set("cursor", `${cursor.publishedAt.toISOString()}|${cursor.id}`);
  return `/admin/articles?${params.toString()}`;
}
