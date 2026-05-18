import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  InternalServerError,
  RateLimitError,
} from "openai";
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
  /**
   * Articles whose LLM call timed out or was aborted. NOT marked as
   * `failed` in the DB — they stay `pending` so the next cron tick
   * retries them. Distinct from `failed` (terminal: schema error,
   * unknown category, etc.).
   */
  timedOut: number;
  /**
   * `true` when we exited the loop early because the wall-clock budget
   * was about to be exceeded. The remaining pending items stay in
   * `pending` status for the next cron tick.
   */
  budgetExhausted: boolean;
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
  /**
   * LLM relevance signal in [0, 1] passed through to the DB so the
   * broadcaster (Phase 8.A) can filter to high-relevance articles. We do
   * NOT use it to gate classification itself — every well-formed article
   * is classified regardless of score; the score just informs downstream
   * surfaces.
   */
  relevanceScore: number;
}

export interface RunClassifyOptions extends ClassifyOptions {
  limit?: number;
  /** Sleep this many ms between articles. Use to stay within LLM rate limits. */
  delayBetweenMs?: number;
  /**
   * Maximum wall-clock time the loop is allowed to spend before
   * returning gracefully. Set this *below* the platform's function
   * cap (Vercel Hobby = 60_000ms) so we can serialise the JSON
   * response and finish before the gateway kills us with a 504.
   *
   * When this budget is exhausted we stop pulling new articles and
   * return the partial summary with `budgetExhausted: true`. The
   * remaining items keep `status = 'pending'` and the next tick
   * picks them up.
   */
  maxWallTimeMs?: number;
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
  // `Infinity` disables the budget — used by the local CLI runner.
  const maxWallTimeMs = options.maxWallTimeMs ?? Infinity;
  // Worst-case allowance for "delay + LLM call + DB write" for a
  // single iteration. The LLM call is hard-capped by the SDK timeout
  // (CEREBRAS_DEFAULT_TIMEOUT_MS = 15_000) so the worst case is
  // 3s delay + 15s LLM (timeout) + ~1s DB+slack = 19s. If we don't
  // have at least this much headroom left we bail out cleanly instead
  // of starting an iteration that could blow through the Vercel cap.
  //
  // Without this guard a single SDK-timeout iteration extends the
  // function past 60s and Vercel returns 504 — exactly the failure
  // mode the wall-clock budget was added to prevent.
  const ITERATION_BUDGET_MS = 19_000;
  log.info("batch_start", { count: pending.length, limit, delayBetweenMs, maxWallTimeMs });

  let classified = 0;
  let failed = 0;
  let timedOut = 0;
  let budgetExhausted = false;
  const tokens = { prompt: 0, completion: 0, total: 0 };

  // Deliberately serial: Cerebras free tier enforces a TPM cap and we
  // wait `delayBetweenMs` (typically 3000ms) between articles to stay
  // under it. Paralelising with Promise.all would trip 429s in seconds
  // and burn the quota; React Review's `async-await-in-loop` lint is
  // a false positive in this exact spot. See app/api/cron/classify
  // for the live `DEFAULT_DELAY_BETWEEN_MS` value and the related
  // Vercel 60s function-cap reasoning.
  for (const [index, article] of pending.entries()) {
    // Budget check BEFORE the inter-article sleep so we don't sit
    // idle just to find out we have no time to actually classify.
    const elapsedMs = Date.now() - startedAt.getTime();
    if (elapsedMs + ITERATION_BUDGET_MS > maxWallTimeMs) {
      budgetExhausted = true;
      log.info("budget_exhausted", {
        elapsedMs,
        maxWallTimeMs,
        remaining: pending.length - index,
      });
      break;
    }
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
        relevanceScore: result.classification.relevance_score,
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
      // Transient errors leave the row in `pending` so the next cron
      // tick retries it. Marking these `failed` would lose them
      // forever to `listPendingArticles`'s status filter.
      //
      // What counts as transient:
      // - Timeouts / user aborts: the LLM didn't *reject* the article,
      //   the request just ran out the clock.
      // - 429 RateLimitError: Cerebras TPM throttle. The next tick (in
      //   the next franja) will have fresh budget.
      // - 5xx InternalServerError: provider-side hiccup.
      // - APIConnectionError (non-timeout subclass): DNS/TCP hiccup.
      //
      // Everything else (schema validation, unknown category, 4xx
      // request errors, etc.) is terminal: the LLM rejected the article
      // for a reason that won't fix itself, so we mark it failed and
      // the operator can re-classify from /admin/articles if needed.
      if (
        err instanceof APIConnectionTimeoutError ||
        err instanceof APIUserAbortError ||
        err instanceof RateLimitError ||
        err instanceof InternalServerError ||
        err instanceof APIConnectionError
      ) {
        timedOut++;
        log.warn("article_transient", {
          articleId: article.id,
          reason: message,
          errorKind: err.constructor.name,
        });
        continue;
      }
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
    // `processed` reflects how many we actually attempted, not how
    // many we pulled from the DB — important when the budget cuts
    // the loop short. Includes timeouts (we attempted them, they
    // just didn't complete).
    processed: classified + failed + timedOut,
    classified,
    failed,
    timedOut,
    budgetExhausted,
    tokens,
  };
  log.info("batch_done", { ...summary });
  return summary;
}
