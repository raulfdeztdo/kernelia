import type { OgCardArticle } from "@/db/queries/articles";
import { routing, type Locale } from "@/i18n/routing";
import { isCategorySlug } from "@/lib/categories";
import { createLogger } from "@/lib/logger";
import type { ArticleCardInput } from "@/lib/og/card";
import { OG_CARD_MAX_AGE_DAYS, hasOwnOgCard, ogCardObjectPath } from "@/lib/permalink";

/**
 * `og-cards` job of the Hepha worker (phase 9.D): keeps Supabase Storage
 * holding one rendered card per locale for every fresh public article, so
 * article pages can point their `og:image` there and Vercel renders none.
 *
 * Runs right after each classify tick (`:02`/`:32` on Hepha), before the
 * hourly broadcast at `:05`, so a card exists by the time anyone shares the
 * article. Idempotent: it only renders what's missing.
 */

/**
 * How long a card stays in Storage. Pages advertise their own card while
 * the article is ≤ `OG_CARD_MAX_AGE_DAYS` old, and an article page stays
 * cached up to 7 more days (`ARTICLE_PAGE_TTL_S`), so a page rendered on
 * day 7 may point at the card until day 14. One day of slack on top.
 */
export const OG_CARD_KEEP_DAYS = OG_CARD_MAX_AGE_DAYS + 7 + 1;

/** Upper bound per run, so a backlog (first run, outage) can't stall a tick. */
export const OG_CARDS_MAX_RENDERS = 120;

export interface OgCardsPlan {
  render: { locale: Locale; article: OgCardArticle; path: string }[];
  remove: string[];
}

/**
 * Pure planning step. `articles` are public articles published within the
 * keep window; `existing` are the object paths already in the bucket.
 */
export function planOgCards(
  articles: readonly OgCardArticle[],
  existing: ReadonlySet<string>,
  now: Date,
  maxRenders = OG_CARDS_MAX_RENDERS,
): OgCardsPlan {
  const keepCutoff = now.getTime() - OG_CARD_KEEP_DAYS * 86_400_000;
  const keep = new Set<string>();
  const render: OgCardsPlan["render"] = [];
  for (const article of articles) {
    if (article.publishedAt.getTime() < keepCutoff) continue;
    for (const locale of routing.locales) {
      const path = ogCardObjectPath(locale, article.id);
      keep.add(path);
      if (!existing.has(path) && hasOwnOgCard(article.publishedAt, now)) {
        render.push({ locale, article, path });
      }
    }
  }
  return {
    render: render.slice(0, maxRenders),
    remove: [...existing].filter((path) => !keep.has(path)),
  };
}

export interface OgCardsDeps {
  listArticles: (since: Date) => Promise<OgCardArticle[]>;
  listExisting: () => Promise<string[]>;
  renderCard: (input: ArticleCardInput) => Promise<Uint8Array>;
  upload: (path: string, png: Uint8Array) => Promise<void>;
  remove: (paths: string[]) => Promise<void>;
  /** Translated category label and "via <source>" line for a locale. */
  labels: (locale: Locale) => {
    category: (slug: string) => string;
    via: (source: string) => string;
  };
  now?: Date;
}

export interface OgCardsSummary {
  articles: number;
  rendered: number;
  failed: number;
  removed: number;
  durationMs: number;
}

const log = createLogger("og_cards");

export async function runOgCardsJob(deps: OgCardsDeps): Promise<OgCardsSummary> {
  const started = Date.now();
  const now = deps.now ?? new Date();
  const since = new Date(now.getTime() - OG_CARD_KEEP_DAYS * 86_400_000);
  const [articles, existing] = await Promise.all([deps.listArticles(since), deps.listExisting()]);
  const plan = planOgCards(articles, new Set(existing), now);

  let rendered = 0;
  let failed = 0;
  // Sequential on purpose: a Raspberry Pi, a handful of cards per tick.
  /* eslint-disable react-review/async-await-in-loop */
  for (const { locale, article, path } of plan.render) {
    try {
      const t = deps.labels(locale);
      const slug = article.categorySlug && isCategorySlug(article.categorySlug) ? article.categorySlug : null;
      const title =
        (locale === "es" ? article.titleEs : article.titleEn) ?? article.originalTitle;
      const png = await deps.renderCard({
        title,
        categorySlug: slug,
        categoryLabel: slug ? t.category(slug) : null,
        via: t.via(article.sourceName),
      });
      await deps.upload(path, png);
      rendered++;
    } catch (err) {
      failed++;
      log.warn("card_failed", { path, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  /* eslint-enable react-review/async-await-in-loop */

  await deps.remove(plan.remove);
  const summary = {
    articles: articles.length,
    rendered,
    failed,
    removed: plan.remove.length,
    durationMs: Date.now() - started,
  };
  log.info("done", { ...summary });
  return summary;
}
