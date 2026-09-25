import type { Metadata } from "next";
import Image from "next/image";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { FollowCta } from "@/components/follow-cta";
import { NewsCard } from "@/components/news-card";
import { ShareButtons } from "@/components/share-buttons";
import type { ListedArticle } from "@/db/queries/articles";
import { Link } from "@/i18n/navigation";
import { isLocale, type Locale } from "@/i18n/routing";
import { articleAlternates, getRelatedArticles, resolveArticle } from "@/lib/article-page";
import { toCardView } from "@/lib/article-view";
import { articleOgImageUrl } from "@/lib/permalink";
import { categoryColorVar, isCategorySlug } from "@/lib/categories";
import { createLogger } from "@/lib/logger";
import { SITE_NAME, getSiteUrl } from "@/lib/site";

/**
 * Article page (Phase 9.B): Kernelia's own URL for every public article.
 *
 * Why it exists: before this, every card, post and email sent readers
 * straight to the publisher, so Kernelia had nothing indexable beyond the
 * home and nothing of its own to share. The page carries the bilingual
 * summary, credits and links the source prominently, and turns the visit
 * into a follow (Telegram / newsletter) or another read (related news).
 *
 * Rendering: ISR. Pages are built on first request and cached for a day —
 * the content of a classified article doesn't change, and crawlers
 * walking thousands of sitemap URLs must not each cost a DB round-trip.
 */

export const revalidate = 86_400;

/**
 * No page is prebuilt at deploy time (thousands of articles, and CI has no
 * DB), but declaring the params makes Next treat unknown slugs as
 * on-demand ISR instead of rendering every request from scratch.
 */
export function generateStaticParams(): { slug: string }[] {
  return [];
}

const RELATED_COUNT = 3;
const log = createLogger("article_page");

interface Props {
  params: Promise<{ locale: string; slug: string }>;
}

function metaDescription(summary: string | null, fallback: string): string {
  const text = summary ?? fallback;
  return text.length <= 160 ? text : `${text.slice(0, 157).trimEnd()}…`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};
  const resolved = await resolveArticle(locale, slug);
  if (resolved.kind !== "ok") return {};
  const { article, canonical } = resolved;
  const description = metaDescription(article.summary, article.title);
  const ogImage = articleOgImageUrl(locale, article.id);
  return {
    title: article.title,
    description,
    alternates: { canonical, languages: articleAlternates(article) },
    openGraph: {
      type: "article",
      url: canonical,
      title: article.title,
      description,
      publishedTime: article.publishedAt.toISOString(),
      siteName: SITE_NAME,
      images: [{ url: ogImage, width: 1200, height: 630, alt: article.title }],
    },
    twitter: { card: "summary_large_image", title: article.title, description, images: [ogImage] },
  };
}

function formatDate(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).format(date);
}

export default async function ArticlePage({ params }: Props) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const resolved = await resolveArticle(locale, slug);
  if (resolved.kind === "not_found") notFound();
  if (resolved.kind === "redirect") permanentRedirect(resolved.to);
  const { article, canonical } = resolved;

  const [t, tCategories] = await Promise.all([
    getTranslations("article"),
    getTranslations("categories"),
  ]);

  const categorySlug =
    article.categorySlug && isCategorySlug(article.categorySlug) ? article.categorySlug : null;
  const categoryLabel = categorySlug ? tCategories(categorySlug) : null;
  const accent = categorySlug ? categoryColorVar(categorySlug) : "var(--color-cat-other)";

  let related: ListedArticle[] = [];
  if (categorySlug) {
    try {
      related = await getRelatedArticles({
        locale,
        categorySlug,
        excludeId: article.id,
        limit: RELATED_COUNT,
      });
    } catch (err) {
      // Related news is a nicety; the article itself must still render.
      log.warn("related_query_failed", {
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Structured data. `isBasedOn` points at the original story: we are a
  // summary of it, not its author, and say so to search engines too.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: article.summary ?? undefined,
    datePublished: article.publishedAt.toISOString(),
    inLanguage: locale,
    mainEntityOfPage: canonical,
    image: [articleOgImageUrl(locale, article.id)],
    isBasedOn: article.url,
    publisher: { "@type": "Organization", name: SITE_NAME, url: getSiteUrl() },
  };

  return (
    <div className="space-y-12">
      <article
        data-article-page
        data-article-id={article.id}
        className="mx-auto max-w-3xl space-y-7"
        style={{ ["--accent" as string]: accent }}
      >
        <script
          type="application/ld+json"
          // JSON.stringify output with `<` escaped can't break out of the tag.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />

        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded text-sm text-[color:var(--color-muted-foreground)] transition hover:text-[color:var(--color-foreground)] focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40 focus-visible:outline-none"
        >
          <span aria-hidden>←</span>
          {t("back")}
        </Link>

        <header className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold tracking-[0.12em] text-[color:var(--color-muted-foreground)] uppercase">
            {categoryLabel && (
              <>
                <span
                  aria-hidden
                  className="size-1.5 rounded-full"
                  style={{ background: "var(--accent)" }}
                />
                <span style={{ color: "var(--accent)" }}>{categoryLabel}</span>
                <span aria-hidden>·</span>
              </>
            )}
            <span>{article.sourceName}</span>
            <span aria-hidden>·</span>
            <time dateTime={article.publishedAt.toISOString()}>
              {formatDate(article.publishedAt, locale)}
            </time>
          </div>
          <h1 className="text-3xl leading-tight font-semibold tracking-tight md:text-4xl">
            {article.title}
          </h1>
        </header>

        {article.imageUrl && (
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-2)]">
            <Image
              src={article.imageUrl}
              alt=""
              fill
              priority
              sizes="(min-width: 768px) 768px, 100vw"
              referrerPolicy="no-referrer"
              className="object-cover"
            />
          </div>
        )}

        {article.summary && (
          <p
            className="border-l-[3px] pl-4 text-lg leading-relaxed text-[color:var(--color-foreground)]/90"
            style={{ borderColor: "var(--accent)" }}
          >
            {article.summary}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-4">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-lg bg-[color:var(--color-accent)] px-5 py-2.5 text-sm font-semibold text-[color:var(--color-background)] shadow-sm transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)] focus-visible:outline-none"
          >
            {t("readFull", { source: article.sourceName })}
            <span aria-hidden>↗</span>
          </a>
          <div className="flex items-center gap-2 text-xs text-[color:var(--color-muted-foreground)]">
            <span>{t("share")}</span>
            <ShareButtons url={canonical} title={article.title} />
          </div>
        </div>

        <p className="text-xs leading-relaxed text-[color:var(--color-muted-foreground)]">
          {t("aiNote", { source: article.sourceName })}
        </p>

        <FollowCta locale={locale} />
      </article>

      {related.length > 0 && categoryLabel && (
        <section aria-labelledby="related-heading" className="space-y-4">
          <h2 id="related-heading" className="text-xl font-semibold tracking-tight">
            {t("related", { category: categoryLabel })}
          </h2>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {related.map((r) => (
              <NewsCard
                key={r.id}
                article={toCardView(r, locale)}
                locale={locale}
                variant="compact"
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
