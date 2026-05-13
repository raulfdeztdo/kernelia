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

export interface RunClassifyOptions extends ClassifyOptions {
  limit?: number;
  fetchPending?: (limit: number) => Promise<PendingArticle[]>;
  onClassified?: (id: string, update: {
    categoryId: string;
    summary: string;
    language: "es" | "en";
  }) => Promise<void>;
  onFailed?: (id: string, reason: string) => Promise<void>;
  resolveCategoryId?: (slug: string) => Promise<string | undefined>;
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
  log.info("batch_start", { count: pending.length, limit });

  let classified = 0;
  let failed = 0;
  const tokens = { prompt: 0, completion: 0, total: 0 };

  for (const article of pending) {
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

      const categoryId = await resolveCategoryId(result.classification.category_slug);
      if (!categoryId) {
        throw new Error(`Unknown category slug: ${result.classification.category_slug}`);
      }

      await onClassified(article.id, {
        categoryId,
        summary: result.classification.summary,
        language: result.classification.language,
      });

      tokens.prompt += result.usage.promptTokens;
      tokens.completion += result.usage.completionTokens;
      tokens.total += result.usage.totalTokens;
      classified++;

      log.info("article_classified", {
        articleId: article.id,
        slug: result.classification.category_slug,
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
