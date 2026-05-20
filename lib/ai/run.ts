import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  InternalServerError,
  RateLimitError,
} from "openai";
import { getCategoryMap } from "@/db/queries/categories";
import {
  classifyReplacingDuplicate,
  listPendingArticles,
  listRecentForDedupe,
  markArticleClassified,
  markArticleFailed,
  markArticleHiddenAsDuplicate,
  markArticleHiddenAsNonAi,
  type PendingArticle,
  type RecentDedupeRow,
} from "@/db/queries/articles";
import { findNearDuplicate, type DedupeMatch } from "@/lib/dedupe/shingle";
import { createLogger } from "@/lib/logger";
import { classifyArticle, type ClassifyOptions } from "./classify";
import { MIN_PUBLISHABLE_TITLE_LENGTH } from "./schemas";

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
  /**
   * Articles that classified cleanly but were hidden because their title
   * near-duplicates a recent article (same event, different source). Not
   * counted in `classified` — they don't reach the public feed, broadcaster,
   * or weekly digest. See `lib/dedupe/shingle.ts` for the heuristic.
   */
  dedupedHidden: number;
  /**
   * Articles that classified cleanly AND replaced a previously-classified
   * near-duplicate because they had an image and the old winner didn't.
   * These ARE counted in `classified` (they go on the feed) — the
   * counter just lets us tell "this tick swapped 2 cluster winners"
   * from "this tick produced 2 net-new classifications".
   */
  dedupedReplaced: number;
  /**
   * Phase 8.B: articles the LLM gated out with `is_ai_related: false`
   * (gadgets, gaming, lifestyle pieces that slip through general-tech
   * feeds like Hipertextual). Marked `hidden` with tag `non_ai`. Not
   * counted in `classified` — they never reach the feed, RSS,
   * newsletter or broadcast.
   */
  hiddenNonAi: number;
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
  // Dedupe collaborators. Inject in tests to skip the real DB layer.
  fetchRecentForDedupe?: () => Promise<RecentDedupeRow[]>;
  onHiddenAsDuplicate?: (
    id: string,
    update: ClassifiedPayload,
    match: DedupeMatch,
  ) => Promise<void>;
  /**
   * Called when the incoming article wins the dedupe contest against an
   * existing classified one (it has an image, the old winner doesn't).
   * The implementation must atomically hide `oldId` and classify
   * `newId` — see `classifyReplacingDuplicate` for the production
   * impl.
   */
  onClassifiedReplacingDuplicate?: (
    newId: string,
    update: ClassifiedPayload,
    match: DedupeMatch,
  ) => Promise<void>;
  /**
   * Pass `false` to bypass dedupe altogether (the local CLI re-classifier
   * uses this so a manual reclassify doesn't re-hide the article it just
   * touched). Defaults to `true` in production.
   */
  dedupeEnabled?: boolean;
  /**
   * Phase 8.B injectable: called when the LLM flags
   * `is_ai_related: false`. Production hides the row with tag `non_ai`;
   * tests use a spy to assert the call shape.
   */
  onHiddenAsNonAi?: (id: string, update: ClassifiedPayload) => Promise<void>;
  /**
   * Phase 8.D: cron-run id stamped into `articles.classified_in_run`
   * for every row this tick touches (classified, hidden as dup,
   * hidden as non-AI, failed). `null` (default) leaves the column
   * NULL — the run still works, just without per-tick attribution.
   */
  cronRunId?: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runClassify(options: RunClassifyOptions = {}): Promise<ClassifySummary> {
  const startedAt = new Date();
  const limit = options.limit ?? DEFAULT_BATCH_SIZE;

  const cronRunId = options.cronRunId ?? null;
  const fetchPending = options.fetchPending ?? listPendingArticles;
  const onClassified =
    options.onClassified ?? ((id, update) => markArticleClassified({ id, ...update }, cronRunId));
  const onFailed = options.onFailed ?? ((id, reason) => markArticleFailed(id, reason, cronRunId));
  const resolveCategoryId =
    options.resolveCategoryId ??
    (async (slug) => {
      const map = await getCategoryMap();
      return map.get(slug);
    });
  const dedupeEnabled = options.dedupeEnabled ?? true;
  const fetchRecentForDedupe = options.fetchRecentForDedupe ?? (() => listRecentForDedupe());
  const onHiddenAsDuplicate =
    options.onHiddenAsDuplicate ??
    ((id, update, match) =>
      markArticleHiddenAsDuplicate({
        id,
        update: { ...update, id },
        dupOfId: match.matchedId,
        similarity: match.similarity,
        cronRunId,
      }));
  const onClassifiedReplacingDuplicate =
    options.onClassifiedReplacingDuplicate ??
    ((newId, update, match) =>
      classifyReplacingDuplicate({
        newId,
        newUpdate: { ...update, id: newId },
        oldId: match.matchedId,
        similarity: match.similarity,
        cronRunId,
      }));
  const onHiddenAsNonAi =
    options.onHiddenAsNonAi ??
    ((id, update) => markArticleHiddenAsNonAi({ id, update: { ...update, id }, cronRunId }));

  const pending = await fetchPending(limit);
  // Snapshot of recent classified/hidden articles for content-level dedupe.
  // Loaded ONCE per cron tick to keep DB pressure flat. We also push every
  // article we classify this tick into `recents` so a Wired/Ars/TechCrunch
  // burst arriving in the same tick still dedupes against itself.
  // Map keyed by article id (not array): `match.matchedId` lookups and
  // in-tick mutations stay O(1), avoiding the `find()/findIndex()` scan
  // that lit up React Review's `js-index-maps` rule. Iteration order is
  // insertion order, which is what `findNearDuplicate` cares about (FIFO
  // when two near-duplicates arrive in the same tick).
  const recentsById = new Map<string, RecentDedupeRow>();
  if (dedupeEnabled) {
    for (const r of await fetchRecentForDedupe()) recentsById.set(r.id, r);
  }
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
  let dedupedHidden = 0;
  let dedupedReplaced = 0;
  let hiddenNonAi = 0;
  let budgetExhausted = false;
  const tokens = { prompt: 0, completion: 0, total: 0 };

  // Deliberately serial: Cerebras free tier enforces a TPM cap and we
  // wait `delayBetweenMs` (typically 3000ms) between articles to stay
  // under it. Paralelising with Promise.all would trip 429s in seconds
  // and burn the quota; React Review's `async-await-in-loop` lint is
  // a false positive in this exact spot. See app/api/cron/classify
  // for the live `DEFAULT_DELAY_BETWEEN_MS` value and the related
  // Vercel 60s function-cap reasoning.
  /* eslint-disable react-review/async-await-in-loop */
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

      const payload: ClassifiedPayload = {
        categoryId,
        titleEs: result.classification.title_es,
        titleEn: result.classification.title_en,
        summaryEs: result.classification.summary_es,
        summaryEn: result.classification.summary_en,
        relevanceScore: result.classification.relevance_score,
      };

      // Always count LLM tokens — the call already happened.
      tokens.prompt += result.usage.promptTokens;
      tokens.completion += result.usage.completionTokens;
      tokens.total += result.usage.totalTokens;

      // Phase 8.B hard gate: if the LLM marked this as non-AI, hide it
      // BEFORE running dedupe. Two reasons:
      //   1. We don't want non-AI rows polluting the dedupe window —
      //      they could legitimately near-duplicate AI articles
      //      (e.g. a GPU launch can look textually similar to an
      //      AI-chip announcement) and steal the cluster winner.
      //   2. Hiding early skips one DB read against `recentsById`
      //      lookup for items that won't ship anyway.
      // The full ES/EN payload is still persisted so /admin/articles
      // can audit the decision and an operator can un-hide a
      // borderline case.
      //
      // Phase 8.I refinement: the LLM sometimes returns a 1-2 char
      // title (Hipertextual's single-word headlines like "X" or "Q*")
      // that survives the relaxed Zod min(1) but is useless on the
      // feed. Treat it as a non-AI hide so the row is audit-visible
      // in /admin/articles without polluting the public surface.
      const titleEsTrim = payload.titleEs.trim();
      const titleEnTrim = payload.titleEn.trim();
      const titleTooShort =
        titleEsTrim.length < MIN_PUBLISHABLE_TITLE_LENGTH ||
        titleEnTrim.length < MIN_PUBLISHABLE_TITLE_LENGTH;
      if (result.classification.is_ai_related === false || titleTooShort) {
        await onHiddenAsNonAi(article.id, payload);
        hiddenNonAi++;
        log.info("article_hidden_non_ai", {
          articleId: article.id,
          slug: categorySlug,
          relevanceScore: payload.relevanceScore,
          source: article.sourceName,
          reason: titleTooShort ? "title_too_short" : "llm_flag",
        });
        continue;
      }

      // Content-level dedupe runs AFTER the LLM (we need the ES title) but
      // BEFORE marking classified. Three outcomes when a match is found:
      //
      //   1. **Replace** the existing winner: only when the candidate has
      //      an image AND the existing winner doesn't (AND the existing
      //      winner is currently `classified`, not already hidden). The
      //      image earns the slot in the public feed; the old winner is
      //      hidden with tag `dup_replaced_by:<newId>`.
      //   2. **Hide** the candidate (existing behaviour, FIFO): any other
      //      case — both have images, neither does, the existing match
      //      was already hidden, etc. The candidate is hidden with tag
      //      `dup_of:<existingId>`.
      //   3. **No match**: classify normally.
      //
      // In all three the hidden row keeps the full payload so the
      // operator can un-hide it from /admin/articles if the heuristic
      // mis-fired.
      const match = dedupeEnabled
        ? findNearDuplicate(
            { id: article.id, title: payload.titleEs },
            Array.from(recentsById.values(), (r) => ({ id: r.id, title: r.titleEs })),
          )
        : null;
      if (match) {
        const matchedRow = recentsById.get(match.matchedId);
        const candidateHasImage = !!article.imageUrl;
        const originalHasImage = !!matchedRow?.imageUrl;
        const originalIsClassified = matchedRow?.isClassified ?? false;
        // Replace path: only if the candidate strictly beats the original
        // on the image criterion AND the original is the current winner
        // (resurrecting a previously-hidden row would mean two visible
        // duplicates in the cluster).
        const shouldReplace =
          candidateHasImage && !originalHasImage && originalIsClassified;

        if (shouldReplace) {
          await onClassifiedReplacingDuplicate(article.id, payload, match);
          // Swap winner in the in-memory `recentsById`: the new row takes
          // the classified slot, the old one is hidden but kept (its
          // title still needs to be visible to subsequent candidates in
          // the same tick so we don't promote a third near-duplicate
          // behind it).
          if (matchedRow) {
            recentsById.set(match.matchedId, {
              id: match.matchedId,
              titleEs: matchedRow.titleEs,
              imageUrl: matchedRow.imageUrl,
              isClassified: false,
            });
          }
          recentsById.set(article.id, {
            id: article.id,
            titleEs: payload.titleEs,
            imageUrl: article.imageUrl,
            isClassified: true,
          });
          dedupedReplaced++;
          classified++;
          log.info("article_classified_replacing_dup", {
            articleId: article.id,
            replaced: match.matchedId,
            similarity: match.similarity,
            slug: categorySlug,
          });
        } else {
          await onHiddenAsDuplicate(article.id, payload, match);
          // Push the hidden article into `recentsById` too: a third
          // source arriving in the same tick can dedupe against this
          // one even though it's hidden. The dedupe query already
          // includes hidden rows from the DB; this keeps in-tick
          // visibility consistent.
          recentsById.set(article.id, {
            id: article.id,
            titleEs: payload.titleEs,
            imageUrl: article.imageUrl,
            isClassified: false,
          });
          dedupedHidden++;
          log.info("article_deduped_hidden", {
            articleId: article.id,
            dupOf: match.matchedId,
            similarity: match.similarity,
            slug: categorySlug,
          });
        }
      } else {
        await onClassified(article.id, payload);
        recentsById.set(article.id, {
          id: article.id,
          titleEs: payload.titleEs,
          imageUrl: article.imageUrl,
          isClassified: true,
        });
        classified++;
        log.info("article_classified", {
          articleId: article.id,
          slug: categorySlug,
          latencyMs: result.latencyMs,
          totalTokens: result.usage.totalTokens,
        });
      }
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
  /* eslint-enable react-review/async-await-in-loop */

  const finishedAt = new Date();
  const summary: ClassifySummary = {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    // `processed` reflects how many we actually attempted, not how
    // many we pulled from the DB — important when the budget cuts
    // the loop short. Includes timeouts (we attempted them, they
    // just didn't complete).
    processed: classified + failed + timedOut + dedupedHidden + hiddenNonAi,
    classified,
    failed,
    timedOut,
    dedupedHidden,
    dedupedReplaced,
    hiddenNonAi,
    budgetExhausted,
    tokens,
  };
  log.info("batch_done", { ...summary });
  return summary;
}
