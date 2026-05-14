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
      className="group card-hover relative flex flex-col overflow-hidden rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface)] hover:-translate-y-0.5 hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-2)] focus-within:border-[color:var(--color-border-strong)]"
      style={{ ["--accent" as string]: accent }}
    >
      <span
        aria-hidden
        className="absolute inset-x-0 top-0 h-[3px]"
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
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <PlaceholderImage accent={accent} label={tCard("noImage")} />
        )}
        {categoryLabel && (
          <span
            className="absolute left-3 top-3 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider text-[color:var(--color-background)] shadow-sm backdrop-blur"
            style={{ background: "var(--accent)" }}
          >
            {categoryLabel}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[color:var(--color-muted-foreground)]">
          <span className="truncate">{article.sourceName}</span>
          <span aria-hidden>·</span>
          <time dateTime={article.publishedAt.toISOString()}>
            {formatRelative(article.publishedAt, locale)}
          </time>
        </div>

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
      </div>
    </article>
  );
}

function PlaceholderImage({ accent, label }: { accent: string; label: string }) {
  return (
    <div
      aria-label={label}
      className="flex h-full w-full items-center justify-center"
      style={{
        background: `radial-gradient(circle at 30% 20%, ${accent} 0%, transparent 55%), linear-gradient(135deg, var(--color-surface-2), var(--color-surface))`,
      }}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-12 w-12 text-[color:var(--color-muted-foreground)] opacity-60"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="m12 3 1.9 4 4.1.4-3 2.9.9 4.7L12 12.7l-3.9 2.3.9-4.7-3-2.9 4.1-.4Z" />
        <path d="M5 19c2-1 5-1 7-1s5 0 7 1" />
      </svg>
    </div>
  );
}
