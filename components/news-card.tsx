"use client";

import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { categoryColorVar, isCategorySlug } from "@/lib/categories";
import { formatRelative } from "@/lib/format";
import { ShareButtons } from "@/components/share-buttons";

/**
 * Wire-shape of an article as consumed by the card. Mirrors
 * `ListedArticle` from `db/queries/articles.ts` but with `publishedAt`
 * as an ISO string so the same payload works for the SSR pass *and* for
 * articles fetched via the `/api/articles` JSON route.
 */
export interface ArticleCardView {
  id: string;
  title: string;
  /** Original publisher URL. */
  url: string;
  /** Kernelia permalink path, locale prefix included (Phase 9.B). */
  href: string;
  /** Absolute Kernelia permalink, what the share buttons hand out. */
  shareUrl: string;
  summary: string | null;
  imageUrl: string | null;
  publishedAt: string;
  sourceName: string;
  categorySlug: string | null;
}

interface NewsCardProps {
  article: ArticleCardView;
  locale: "es" | "en";
  /**
   * - `full` (home): image, category, title, summary clamped to three
   *   lines, source/date and share buttons.
   * - `compact` ("Más sobre X" on article pages): image and title only —
   *   the reader is already inside a category, the headline has to earn
   *   the click on its own.
   */
  variant?: "full" | "compact";
}

export function NewsCard({ article, locale, variant = "full" }: NewsCardProps) {
  const compact = variant === "compact";
  const tCategories = useTranslations("categories");

  const slug = article.categorySlug && isCategorySlug(article.categorySlug)
    ? article.categorySlug
    : null;
  const accent = slug ? categoryColorVar(slug) : "var(--color-cat-other)";
  const categoryLabel = slug ? tCategories(slug) : null;

  return (
    <article
      data-article-id={article.id}
      className="group relative isolate flex flex-col overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] transition-colors hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-2)] focus-within:border-[color:var(--color-accent)] focus-within:ring-2 focus-within:ring-[color:var(--color-accent)]/30"
      style={{ ["--accent" as string]: accent }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-[3px]"
        style={{ background: "var(--accent)" }}
      />

      <div className="relative aspect-[16/9] w-full overflow-hidden bg-[color:var(--color-surface-2)]">
        {article.imageUrl ? (
          // `next/image` with `fill` lets us keep the existing aspect-ratio
          // wrapper. `sizes` tells the optimiser to generate srcset for the
          // three breakpoints the grid actually uses (1 / 2 / 3 columns).
          // `unoptimized` is intentionally NOT set — the proxy strips
          // Set-Cookie and blocks SVG XSS, both of which matter when the
          // host is arbitrary.
          <Image
            src={article.imageUrl}
            alt=""
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            referrerPolicy="no-referrer"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <SourceCover
            accent={accent}
            sourceName={article.sourceName}
            categoryLabel={categoryLabel}
          />
        )}
      </div>

      <div className={`flex flex-1 flex-col gap-2.5 ${compact ? "p-4 pl-5" : "p-5 pl-6"}`}>
        {categoryLabel && !compact && (
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ background: "var(--accent)" }}
            />
            <span>{categoryLabel}</span>
          </div>
        )}

        <h3
          className={`font-semibold leading-snug tracking-tight text-[color:var(--color-foreground)] ${compact ? "text-base" : "text-lg"}`}
        >
          {/*
           * Phase 9.B: the title opens the article's page on Kernelia
           * (summary, source CTA, related news) instead of the publisher.
           * Same tab — it is our own page now.
           */}
          <Link
            href={article.href as Route}
            // Desktop keeps `line-clamp-3` so the grid rows have a
            // predictable maximum height (titles longer than three
            // lines truncate). On mobile the cards are stacked one per
            // row, the user reads them one at a time, and truncated
            // titles read like clickbait, so the title flows to its
            // full length.
            className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline sm:line-clamp-3"
          >
            {article.title}
          </Link>
        </h3>

        {!compact && article.summary && (
          // Phase 9.B: clamped to three lines. The card is now a teaser
          // for the article page, which shows the summary in full, so a
          // cut here no longer hides information behind the publisher's
          // site — it just keeps the grid scannable. `mt-auto` on the
          // footer below keeps rows aligned regardless of title length.
          <p className="line-clamp-3 text-sm text-[color:var(--color-muted-foreground)]">
            {article.summary}
          </p>
        )}

        {!compact && (
          <div className="mt-auto flex items-end justify-between gap-2 pt-2 text-xs text-[color:var(--color-muted-foreground)]">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate">{article.sourceName}</span>
              <span aria-hidden>·</span>
              {/*
               * The relative timestamp is computed against `new Date()` on both
               * server and client. Between SSR and hydration a few seconds can
               * pass, so the formatted string may drift by one unit. Suppress
               * the warning rather than locking the SSR value, which would
               * then look stale forever on long client sessions.
               */}
              <time dateTime={article.publishedAt} suppressHydrationWarning>
                {formatRelative(article.publishedAt, locale)}
              </time>
            </div>
            {/*
             * Share buttons sit on the same baseline as the source/date row
             * but above the card's stretched-link via `relative z-10` (set
             * inside the component). Clicks here don't fall through to the
             * title link's after:absolute overlay.
             */}
            <ShareButtons url={article.shareUrl} title={article.title} />
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Designed cover for articles that ship without an image. Instead of looking
 * like a missing-asset placeholder (the old radial-gradient + sparkles), it
 * shows the publication name in large typography over the category accent,
 * so every card reads as intentional.
 */
function SourceCover({
  accent,
  sourceName,
  categoryLabel,
}: {
  accent: string;
  sourceName: string;
  categoryLabel: string | null;
}) {
  return (
    <div
      aria-hidden
      className="relative flex h-full w-full flex-col justify-between p-5"
      style={{
        background: [
          // Top-left accent wash.
          `radial-gradient(circle at 15% 0%, color-mix(in oklch, ${accent} 55%, transparent) 0%, transparent 60%)`,
          // Bottom-right depth.
          `radial-gradient(circle at 100% 100%, color-mix(in oklch, ${accent} 22%, transparent) 0%, transparent 50%)`,
          // Base.
          `linear-gradient(135deg, var(--color-surface-2), var(--color-surface))`,
        ].join(", "),
      }}
    >
      {/* Subtle inner border so the card edge stays crisp. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-none ring-1 ring-inset ring-white/5"
      />

      {categoryLabel && (
        <span
          className="z-10 text-[10px] font-semibold uppercase tracking-[0.18em] text-[color:var(--color-foreground)]/70"
          style={{ color: accent }}
        >
          {categoryLabel}
        </span>
      )}

      <span
        className="z-10 mt-auto text-2xl font-bold leading-tight tracking-tight text-[color:var(--color-foreground)]/90 sm:text-[1.7rem]"
        style={{
          fontFeatureSettings: '"ss01"',
        }}
      >
        {sourceName}
      </span>
    </div>
  );
}
