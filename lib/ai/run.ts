import { getCategoryMap } from "@/db/queries/categories";
import {
  listPendingArticles,
  markArticleClassified,
  markArticleFailed,
  type PendingArticle,
} from "@/db/queries/articles";
import { createLogger } from "@/lib/logger";
import { classifyArticle, type ClassifyOptions } from "./classify";

const log = createLogger("classify");

export const DEFAULT_BATCH_SIZE = 10;

export interface ClassifySummary {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  processed: number;
  classified: number;
  failed: number;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export interface ClassifiedPayload {
  categoryId: string;
  titleEs: string;
  titleEn: string;
  summaryEs: string;
  summaryEn: string;
}

export interface RunClassifyOptions extends ClassifyOptions {
  limit?: number;
  /** Sleep this many ms between articles. Use to stay within LLM rate limits. */
  delayBetweenMs?: number;
  fetchPending?: (limit: number) => Promise<PendingArticle[]>;
  onClassified?: (id: string, update: ClassifiedPayload) => Promise<void>;
  onFailed?: (id: string, reason: string) => Promise<void>;
  resolveCategoryId?: (slug: string) => Promise<string | undefined>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runClassify(options: RunClassifyOptions = {}): Promise<ClassifySummary> {
  const startedAt = new Date();
  const limit = options.limit ?? DEFAULT_BATCH_SIZE;

  const fetchPending = options.fetchPending ?? listPendingArticles;
  const onClassified = options.onClassified ?? ((id, update) => markArticleClassified({ id, ...update }));
  const onFailed = options.onFailed ?? markArticleFailed;
  const resolveCategoryId =
    options.resolveCategoryId ??
    (async (slug) => {
      const map = await getCategoryMap();
      return map.get(slug);
    });

  const pending = await fetchPending(limit);
  const delayBetweenMs = options.delayBetweenMs ?? 0;
  log.info("batch_start", { count: pending.length, limit, delayBetweenMs });

  let classified = 0;
  let failed = 0;
  const tokens = { prompt: 0, completion: 0, total: 0 };

  // Deliberately serial: Cerebras free tier enforces a TPM cap and we
  // wait `delayBetweenMs` (typically 3000ms) between articles to stay
  // under it. Paralelising with Promise.all would trip 429s in seconds
  // and burn the quota; React Review's `async-await-in-loop` lint is
  // a false positive in this exact spot. See app/api/cron/classify
  // for the live `DEFAULT_DELAY_BETWEEN_MS` value and the related
  // Vercel 60s function-cap reasoning.
  for (const [index, article] of pending.entries()) {
    if (index > 0 && delayBetweenMs > 0) await sleep(delayBetweenMs);
    try {
      const result = await classifyArticle(
        {
          title: article.title,
          excerpt: article.rawExcerpt,
          url: article.url,
          sourceName: article.sourceName,
          sourceLanguage: article.sourceLanguage,
        },
        options,
      );

      // Hoist the deep member access read three times below.
      const { category_slug: categorySlug } = result.classification;
      const categoryId = await resolveCategoryId(categorySlug);
      if (!categoryId) {
        throw new Error(`Unknown category slug: ${categorySlug}`);
      }

      await onClassified(article.id, {
        categoryId,
        titleEs: result.classification.title_es,
        titleEn: result.classification.title_en,
        summaryEs: result.classification.summary_es,
        summaryEn: result.classification.summary_en,
      });

      tokens.prompt += result.usage.promptTokens;
      tokens.completion += result.usage.completionTokens;
      tokens.total += result.usage.totalTokens;
      classified++;

      log.info("article_classified", {
        articleId: article.id,
        slug: categorySlug,
        latencyMs: result.latencyMs,
        totalTokens: result.usage.totalTokens,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed++;
      log.warn("article_failed", { articleId: article.id, reason: message });
      try {
        await onFailed(article.id, message);
      } catch (writeErr) {
        const writeMessage = writeErr instanceof Error ? writeErr.message : String(writeErr);
        log.error("mark_failed_error", { articleId: article.id, reason: writeMessage });
      }
    }
  }

  const finishedAt = new Date();
  const summary: ClassifySummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    processed: pending.length,
    classified,
    failed,
    tokens,
  };
  log.info("batch_done", { ...summary });
  return summary;
}
