import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArticleList } from "@/components/article-list";
import type { ArticleCardView } from "@/components/news-card";
import { CategoryFilter } from "@/components/category-filter";
import { NewsletterForm } from "@/components/newsletter-form";
import {
  countClassifiedArticles,
  getCategoryFacets,
  listClassifiedArticles,
  PUBLIC_HIDDEN_CATEGORY_SLUG,
  type ListedArticle,
} from "@/db/queries/articles";
import { CATEGORY_SLUGS, parseCategoryParam } from "@/lib/categories";
import { createLogger } from "@/lib/logger";
import { isLocale } from "@/i18n/routing";
import { localeAlternates, localizedUrl } from "@/lib/site";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  // Both translation lookups are independent — race them so metadata
  // generation isn't a waterfall.
  const [t, tHome] = await Promise.all([
    getTranslations({ locale, namespace: "metadata" }),
    getTranslations({ locale, namespace: "home" }),
  ]);
  return {
    title: t("title"),
    description: t("description"),
    alternates: {
      canonical: localizedUrl(locale, "/"),
      languages: localeAlternates("/"),
    },
    openGraph: {
      title: tHome("heading"),
      description: tHome("subheading"),
      url: localizedUrl(locale, "/"),
    },
  };
}

/**
 * First batch rendered by the server. Big enough to fill a typical viewport
 * (3-col grid, ~6 rows) so SEO crawlers and first paint see a real feed.
 * Subsequent client-side appends use `LOAD_MORE_PAGE_SIZE` per click.
 */
const INITIAL_PAGE_SIZE = 18;
const LOAD_MORE_PAGE_SIZE = 6;
const log = createLogger("home");

interface HomePageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function encodeCursor(article: ListedArticle): string {
  return `${article.publishedAt.toISOString()}|${article.id}`;
}

function toView(a: ListedArticle): ArticleCardView {
  return {
    id: a.id,
    title: a.title,
    url: a.url,
    summary: a.summary,
    imageUrl: a.imageUrl,
    publishedAt: a.publishedAt.toISOString(),
    sourceName: a.sourceName,
    categorySlug: a.categorySlug,
  };
}

export default async function HomePage({ params, searchParams }: HomePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  // searchParams and the home-namespace translations are independent —
  // race them so the page doesn't waterfall before the DB query starts.
  const [sp, t, tCategories] = await Promise.all([
    searchParams,
    getTranslations("home"),
    getTranslations("categories"),
  ]);

  const selectedCategories = parseCategoryParam(sp.category);
  const q = typeof sp.q === "string" ? sp.q : undefined;

  let articles: ListedArticle[] = [];
  let facets: Record<string, number> = {};
  let total = 0;
  let errored = false;

  try {
    const [list, facetRows, totalCount] = await Promise.all([
      listClassifiedArticles({
        locale: locale as "es" | "en",
        categorySlugs: selectedCategories,
        q,
        // Fetch one extra so we can detect whether more pages exist
        // without a separate count() query.
        limit: INITIAL_PAGE_SIZE + 1,
      }),
      getCategoryFacets(),
      // Counts the whole filtered pool (under the same per-source cap).
      // Stays stable as the user clicks "Cargar más" — that button
      // only appends client-side, it doesn't change the total.
      countClassifiedArticles({
        locale: locale as "es" | "en",
        categorySlugs: selectedCategories,
        q,
      }),
    ]);
    articles = list;
    facets = Object.fromEntries(facetRows.map((r) => [r.slug, r.count]));
    total = totalCount;
  } catch (err) {
    errored = true;
    log.error("home_query_failed", {
      reason: err instanceof Error ? err.message : String(err),
    });
  }

  const hasMore = articles.length > INITIAL_PAGE_SIZE;
  const visible = hasMore ? articles.slice(0, INITIAL_PAGE_SIZE) : articles;
  const nextCursor =
    hasMore && visible.length > 0
      ? encodeCursor(visible[visible.length - 1]!)
      : null;

  // Key forces ArticleList to remount when filters change, so the client
  // state (appended cards, cursor) doesn't bleed across filter changes.
  const listKey = `${locale}|${q ?? ""}|${selectedCategories.join(",")}`;

  // Same visible-categories list the about-page form uses — the LLM
  // catch-all `other` is excluded so subscribers can't filter by it.
  // Computed here (server side) so the i18n labels resolve inside a
  // server component and the client form stays presentational.
  const visibleSlugs = CATEGORY_SLUGS.filter((s) => s !== PUBLIC_HIDDEN_CATEGORY_SLUG);
  const categoryLabels = Object.fromEntries(
    CATEGORY_SLUGS.map((slug) => [slug, tCategories(slug)]),
  );

  return (
    <section className="space-y-8">
      {/*
       * Header band. Two-column on `lg` (title block + newsletter
       * callout side by side) and stacked everywhere else. The
       * callout intentionally lives at the SAME LEVEL as the heading
       * — the about-page card was a quieter second home for it, and
       * we want the highest-conversion surface (the feed) to push
       * the digest signup too. The `items-start` keeps the heading
       * top-aligned with the card so they read as a pair on desktop.
       */}
      <div className="grid gap-6 lg:grid-cols-[1fr_24rem] lg:items-start">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("heading")}</h1>
          <p className="max-w-2xl text-[color:var(--color-muted-foreground)]">
            {t("subheading")}
          </p>
        </div>
        <aside
          aria-labelledby="home-newsletter-heading"
          className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4"
        >
          <h2
            id="home-newsletter-heading"
            className="mb-1 text-base font-medium"
          >
            {t("newsletterCallout.title")}
          </h2>
          <p className="mb-3 text-sm text-[color:var(--color-muted-foreground)]">
            {t("newsletterCallout.body")}
          </p>
          <NewsletterForm
            locale={locale as "es" | "en"}
            categorySlugs={visibleSlugs}
            categoryLabels={categoryLabels}
          />
        </aside>
      </div>

      {/*
        Both CategoryFilter and ArticleList call useSearchParams() to
        keep their UI in sync with URL state. Wrapping each in
        Suspense isolates the client-rendering boundary to that slot
        — without it Next bails the entire page out to CSR on every
        nav.
      */}
      <Suspense fallback={<div aria-hidden className="h-9" />}>
        <CategoryFilter selected={selectedCategories} facets={facets} />
      </Suspense>

      {errored ? (
        <EmptyOrError title={t("error.title")} body={t("error.body")} accent="error" />
      ) : visible.length === 0 ? (
        <EmptyOrError title={t("noResults.title")} body={t("noResults.body")} accent="muted" />
      ) : (
        <Suspense fallback={<div aria-hidden className="h-9" />}>
          <ArticleList
            key={listKey}
            initialItems={visible.map(toView)}
            initialCursor={nextCursor}
            locale={locale as "es" | "en"}
            pageSize={LOAD_MORE_PAGE_SIZE}
            total={total}
          />
        </Suspense>
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
