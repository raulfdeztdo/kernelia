import Link from "next/link";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CategoryFilter } from "@/components/category-filter";
import { NewsCard } from "@/components/news-card";
import {
  getCategoryFacets,
  listClassifiedArticles,
  type ListedArticle,
} from "@/db/queries/articles";
import { parseCategoryParam, type CategorySlug } from "@/lib/categories";
import { createLogger } from "@/lib/logger";
import { isLocale } from "@/i18n/routing";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PAGE_SIZE = 18;
const log = createLogger("home");

interface HomePageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function parseCursor(raw: string | string[] | undefined): { publishedAt: Date; id: string } | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  const [ts, id] = raw.split("|");
  if (!ts || !id) return undefined;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return undefined;
  return { publishedAt: d, id };
}

function encodeCursor(article: ListedArticle): string {
  return `${article.publishedAt.toISOString()}|${article.id}`;
}

function buildLink(params: {
  q?: string;
  categorySlugs: CategorySlug[];
  cursor?: string;
}): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.categorySlugs.length > 0) sp.set("category", params.categorySlugs.join(","));
  if (params.cursor) sp.set("cursor", params.cursor);
  const qs = sp.toString();
  return qs ? `?${qs}` : "?";
}

export default async function HomePage({ params, searchParams }: HomePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const sp = await searchParams;
  const t = await getTranslations("home");

  const selectedCategories = parseCategoryParam(sp.category);
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const cursor = parseCursor(sp.cursor);

  let articles: ListedArticle[] = [];
  let facets: Record<string, number> = {};
  let errored = false;

  try {
    const [list, facetRows] = await Promise.all([
      listClassifiedArticles({
        categorySlugs: selectedCategories,
        q,
        limit: PAGE_SIZE + 1,
        cursor,
      }),
      getCategoryFacets(),
    ]);
    articles = list;
    facets = Object.fromEntries(facetRows.map((r) => [r.slug, r.count]));
  } catch (err) {
    errored = true;
    log.error("home_query_failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  const hasMore = articles.length > PAGE_SIZE;
  const visible = hasMore ? articles.slice(0, PAGE_SIZE) : articles;
  const nextCursor = hasMore ? encodeCursor(visible[visible.length - 1]!) : undefined;

  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("heading")}</h1>
        <p className="max-w-2xl text-[color:var(--color-muted-foreground)]">{t("subheading")}</p>
      </div>

      <CategoryFilter selected={selectedCategories} facets={facets} />

      {errored ? (
        <EmptyOrError title={t("error.title")} body={t("error.body")} accent="error" />
      ) : visible.length === 0 ? (
        <EmptyOrError title={t("noResults.title")} body={t("noResults.body")} accent="muted" />
      ) : (
        <>
          <p className="text-sm text-[color:var(--color-muted-foreground)]">
            {t("resultsCount", { count: visible.length })}
          </p>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((article) => (
              <NewsCard
                key={article.id}
                article={article}
                locale={locale as "es" | "en"}
              />
            ))}
          </div>
          {hasMore && nextCursor && (
            <div className="flex justify-center pt-4">
              <Link
                href={buildLink({
                  q: q ?? undefined,
                  categorySlugs: selectedCategories,
                  cursor: nextCursor,
                })}
                className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-6 py-2.5 text-sm font-medium transition hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-2)]"
              >
                {t("loadMore")}
              </Link>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EmptyOrError({
  title,
  body,
  accent,
}: {
  title: string;
  body: string;
  accent: "muted" | "error";
}) {
  return (
    <div
      className={`rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-10 text-center ${
        accent === "error" ? "" : ""
      }`}
    >
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-[color:var(--color-muted-foreground)]">{body}</p>
    </div>
  );
}
