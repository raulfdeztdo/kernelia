import { getTranslations } from "next-intl/server";
import { categoryColorVar, isCategorySlug } from "@/lib/categories";
import { formatRelative } from "@/lib/format";
import type { ListedArticle } from "@/db/queries/articles";

interface NewsCardProps {
  article: ListedArticle;
  locale: "es" | "en";
}

export async function NewsCard({ article, locale }: NewsCardProps) {
  const tCategories = await getTranslations("categories");
  const tCard = await getTranslations("card");

  const slug = article.categorySlug && isCategorySlug(article.categorySlug)
    ? article.categorySlug
    : null;
  const accent = slug ? categoryColorVar(slug) : "var(--color-cat-other)";
  const categoryLabel = slug ? tCategories(slug) : null;

  return (
    <article
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
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={article.imageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
          />
        ) : (
          <SourceCover
            accent={accent}
            sourceName={article.sourceName}
            categoryLabel={categoryLabel}
          />
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2.5 p-5 pl-6">
        {categoryLabel && (
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--color-muted-foreground)]">
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--accent)" }}
            />
            <span>{categoryLabel}</span>
          </div>
        )}

        <h3 className="text-lg font-semibold leading-snug tracking-tight text-[color:var(--color-foreground)]">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-3 outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
            aria-label={tCard("readOriginal", { source: article.sourceName })}
          >
            {article.title}
          </a>
        </h3>

        {article.summary && (
          <p className="line-clamp-3 text-sm text-[color:var(--color-muted-foreground)]">
            {article.summary}
          </p>
        )}

        <div className="mt-auto flex items-center gap-2 pt-2 text-xs text-[color:var(--color-muted-foreground)]">
          <span className="truncate">{article.sourceName}</span>
          <span aria-hidden>·</span>
          <time dateTime={article.publishedAt.toISOString()}>
            {formatRelative(article.publishedAt, locale)}
          </time>
        </div>
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
