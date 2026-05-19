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
       * Header band. Two-column on lg: title/desc on the left,
       * newsletter banner on the right. Stacked on mobile.
       */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-center">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("heading")}</h1>
          <p className="max-w-2xl text-[color:var(--color-muted-foreground)]">
            {t("subheading")}
          </p>
        </div>

        {/*
         * Newsletter banner — right half on desktop only.
         * On mobile we show a minimal pill link to /about#subscribe
         * so the newsletter CTA doesn't push the article feed far down.
         */}

        {/* Mobile: compact link pill */}
        <div className="lg:hidden text-center">
        <a
          href={`/${locale === "es" ? "" : locale + "/"}about#subscribe`}
          className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-accent)]/30 bg-[color:var(--color-accent)]/10 px-4 py-2 text-sm font-medium text-[color:var(--color-accent)] transition hover:bg-[color:var(--color-accent)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect width="20" height="16" x="2" y="4" rx="2" />
            <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
          </svg>
          {t("newsletterCallout.mobileLink")}
        </a>
        </div>

        {/* Desktop: full newsletter form */}
        <aside
          aria-labelledby="home-newsletter-heading"
          className="relative hidden overflow-hidden rounded-xl border border-[color:var(--color-accent)]/20 bg-gradient-to-br from-[color:var(--color-accent)]/10 via-[color:var(--color-surface)] to-[color:var(--color-surface)] px-5 py-4 lg:block"
        >
          {/* Decorative blurred blob */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-6 -top-6 size-36 rounded-full bg-[color:var(--color-accent)]/15 blur-3xl"
          />
          <div className="relative flex items-start gap-3">
            <span
              aria-hidden
              className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--color-accent)]/15 text-[color:var(--color-accent)]"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect width="20" height="16" x="2" y="4" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <h2
                id="home-newsletter-heading"
                className="text-sm font-semibold leading-tight text-[color:var(--color-foreground)]"
              >
                {t("newsletterCallout.title")}
              </h2>
              <p className="mb-3 mt-0.5 text-xs text-[color:var(--color-muted-foreground)]">
                {t("newsletterCallout.body")}
              </p>
              <NewsletterForm
                locale={locale as "es" | "en"}
                categorySlugs={visibleSlugs}
                categoryLabels={categoryLabels}
                compact
              />
            </div>
          </div>
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
