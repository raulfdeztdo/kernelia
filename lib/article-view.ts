import type { ArticleCardView } from "@/components/news-card";
import type { ListedArticle } from "@/db/queries/articles";
import type { Locale } from "@/i18n/routing";
import { articleHref, articleUrl } from "@/lib/permalink";

/**
 * `ListedArticle` (DB row) → `ArticleCardView` (wire shape the card
 * renders). Shared by the home SSR pass, `/api/articles` ("load more")
 * and the related list on article pages, so the three can never
 * disagree on where a card links to.
 */
export function toCardView(a: ListedArticle, locale: Locale): ArticleCardView {
  return {
    id: a.id,
    title: a.title,
    url: a.url,
    href: articleHref(locale, a.id, a.title),
    shareUrl: articleUrl(locale, a.id, a.title),
    summary: a.summary,
    imageUrl: a.imageUrl,
    publishedAt: a.publishedAt.toISOString(),
    sourceName: a.sourceName,
    categorySlug: a.categorySlug,
  };
}
