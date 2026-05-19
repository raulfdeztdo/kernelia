import Link from "next/link";
import {
  ADMIN_ARTICLES_SORT_COLUMNS,
  listAdminArticles,
  type AdminArticlesSortColumn,
  type AdminArticlesSortDir,
} from "@/db/queries/admin-articles";
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

const DEFAULT_SORT: AdminArticlesSortColumn = "publishedAt";
const DEFAULT_DIR: AdminArticlesSortDir = "desc";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function isStatus(v: unknown): v is ArticleStatus {
  return typeof v === "string" && (articleStatusEnum.enumValues as readonly string[]).includes(v);
}

function isSortColumn(v: unknown): v is AdminArticlesSortColumn {
  return (
    typeof v === "string" &&
    (ADMIN_ARTICLES_SORT_COLUMNS as readonly string[]).includes(v)
  );
}

function isDir(v: unknown): v is AdminArticlesSortDir {
  return v === "asc" || v === "desc";
}

export default async function AdminArticlesPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const statusFilter = isStatus(sp.status) ? sp.status : undefined;
  const categoryFilter = typeof sp.category === "string" && sp.category ? sp.category : undefined;
  const sourceFilter = typeof sp.source === "string" && sp.source ? sp.source : undefined;
  const sort = isSortColumn(sp.sort) ? sp.sort : DEFAULT_SORT;
  const dir = isDir(sp.dir) ? sp.dir : DEFAULT_DIR;

  // Cursor encoded as `<sortField>|<sortValue>|<id>`. If the cursor's
  // sort field doesn't match the active one (because the user clicked a
  // different header mid-pagination), it is silently dropped — paging
  // restarts from the top in the new order.
  const cursor = parseCursor(typeof sp.cursor === "string" ? sp.cursor : undefined, sort);

  const [page, allCategories, allSources] = await Promise.all([
    listAdminArticles({
      status: statusFilter,
      categoryId: categoryFilter,
      sourceId: sourceFilter,
      sort,
      dir,
      cursor,
      limit: 50,
    }),
    listCategories(),
    listSourcesForAdmin(),
  ]);

  const categoryOptions = allCategories.map((c) => ({ id: c.id, slug: c.slug, nameEs: c.nameEs }));

  // Carry the active filters into every header link so clicking a sort
  // arrow doesn't blow away `status=failed`, `category=...`, etc.
  const filtersForHref: FilterParams = {
    status: statusFilter,
    category: categoryFilter,
    source: sourceFilter,
  };

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
        {/*
         * Preserve the active sort across filter changes so the operator
         * doesn't lose the orden they were eyeballing whenever they tweak
         * the status / category / fuente dropdowns.
         */}
        {sort !== DEFAULT_SORT ? <input type="hidden" name="sort" value={sort} /> : null}
        {dir !== DEFAULT_DIR ? <input type="hidden" name="dir" value={dir} /> : null}
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
              <SortableHeader col="title" current={sort} dir={dir} filters={filtersForHref}>
                Título
              </SortableHeader>
              <SortableHeader col="sourceName" current={sort} dir={dir} filters={filtersForHref}>
                Fuente
              </SortableHeader>
              <SortableHeader col="categoryNameEs" current={sort} dir={dir} filters={filtersForHref}>
                Categoría
              </SortableHeader>
              <SortableHeader col="publishedAt" current={sort} dir={dir} filters={filtersForHref}>
                Publicado
              </SortableHeader>
              <SortableHeader col="status" current={sort} dir={dir} filters={filtersForHref}>
                Status
              </SortableHeader>
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
                  {/*
                   * On desktop the title column is capped to 320px and clamped
                   * to two lines so the grid stays scannable. On mobile the
                   * table scrolls horizontally anyway, so we let the title
                   * flow to its full length — easier for the operator to
                   * confirm at a glance which article they're acting on.
                   */}
                  <td className="px-3 py-2 md:max-w-[320px]">
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer"
                      className="underline-offset-2 hover:underline md:line-clamp-2"
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
                    {formatDateTime(row.publishedAt)}
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
            href={buildNextHref(sort, dir, filtersForHref, page.nextCursor)}
            className="rounded-md border border-border px-3 py-1.5 hover:bg-surface-2"
          >
            Siguiente →
          </Link>
        ) : null}
      </nav>
    </div>
  );
}

interface FilterParams {
  status?: ArticleStatus;
  category?: string;
  source?: string;
}

interface SortableHeaderProps {
  col: AdminArticlesSortColumn;
  current: AdminArticlesSortColumn;
  dir: AdminArticlesSortDir;
  filters: FilterParams;
  children: React.ReactNode;
}

function SortableHeader({ col, current, dir, filters, children }: SortableHeaderProps) {
  // Click toggles direction if we're already on this column, otherwise
  // moves to this column with the column's natural default: dates default
  // to desc (newest first), strings/enums default to asc (A→Z).
  const isActive = current === col;
  const naturalDefault: AdminArticlesSortDir =
    col === "publishedAt" || col === "ingestedAt" ? "desc" : "asc";
  const nextDir: AdminArticlesSortDir = isActive
    ? dir === "asc"
      ? "desc"
      : "asc"
    : naturalDefault;

  const href = buildSortHref(col, nextDir, filters);
  const arrow = isActive ? (dir === "asc" ? " ↑" : " ↓") : " ↕";

  return (
    <th className="px-3 py-2 font-medium">
      <Link
        href={href}
        className={`inline-flex items-center gap-1 hover:text-foreground ${isActive ? "text-foreground" : ""}`}
        aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}
      >
        {children}
        <span aria-hidden className="text-[10px] opacity-60">
          {arrow}
        </span>
      </Link>
    </th>
  );
}

function buildSortHref(
  col: AdminArticlesSortColumn,
  dir: AdminArticlesSortDir,
  filters: FilterParams,
): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.category) params.set("category", filters.category);
  if (filters.source) params.set("source", filters.source);
  if (col !== DEFAULT_SORT) params.set("sort", col);
  if (dir !== DEFAULT_DIR) params.set("dir", dir);
  // Sort changes always reset pagination to page 1: a cursor generated
  // under a different order is meaningless.
  const qs = params.toString();
  return qs ? `/admin/articles?${qs}` : "/admin/articles";
}

function parseCursor(
  raw: string | undefined,
  activeSort: AdminArticlesSortColumn,
): { sortValue: string; id: string } | undefined {
  if (!raw) return undefined;
  const parts = raw.split("|");
  if (parts.length < 3) return undefined;
  const [sortField, sortValue, ...idParts] = parts;
  // Cursor only valid for the current sort. If the user switched columns
  // mid-pagination, we silently start over from the top.
  if (sortField !== activeSort) return undefined;
  if (!sortValue && sortValue !== "") return undefined;
  const id = idParts.join("|"); // ids are uuids without `|` but be defensive
  if (!id) return undefined;
  return { sortValue, id };
}

function buildNextHref(
  sort: AdminArticlesSortColumn,
  dir: AdminArticlesSortDir,
  filters: FilterParams,
  cursor: { sortValue: string; id: string },
): string {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.category) params.set("category", filters.category);
  if (filters.source) params.set("source", filters.source);
  if (sort !== DEFAULT_SORT) params.set("sort", sort);
  if (dir !== DEFAULT_DIR) params.set("dir", dir);
  params.set("cursor", `${sort}|${cursor.sortValue}|${cursor.id}`);
  return `/admin/articles?${params.toString()}`;
}

/**
 * Display format: `YYYY-MM-DD HH:mm` (UTC). Showing the time disambiguates
 * articles published the same day (which is most of them on a busy news
 * cycle) and matches what the sort column now orders by under the hood.
 */
function formatDateTime(d: Date): string {
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}`;
}
