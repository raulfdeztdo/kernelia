import {
  APIConnectionError,
  APIConnectionTimeoutError,
  InternalServerError,
  RateLimitError,
} from "openai";
import { describe, expect, it, vi } from "vitest";
import { classifyArticle } from "@/lib/ai/classify";
import { classificationSchema, CATEGORY_SLUGS } from "@/lib/ai/schemas";
import { runClassify } from "@/lib/ai/run";

function makeClient(
  payload: unknown,
  usage = { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
) {
  return {
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [
            {
              message: {
                content: typeof payload === "string" ? payload : JSON.stringify(payload),
              },
            },
          ],
          usage,
        })),
      },
    },
  } as never;
}

const validPayload = {
  category_slug: "llm",
  title_es: "OpenAI lanza GPT-5 con uso agentico de herramientas",
  title_en: "OpenAI releases GPT-5 with agentic tool use",
  summary_es: "OpenAI presenta un modelo capaz de encadenar herramientas de forma nativa.",
  summary_en: "OpenAI ships a model that can chain browser and file tools natively.",
  relevance_score: 0.95,
};

const sampleArticle = {
  title: "OpenAI releases GPT-5 with agentic tool use",
  excerpt: "The new model can chain browser and file tools natively.",
  url: "https://example.com/a",
  sourceName: "Example",
  sourceLanguage: "en" as const,
};

describe("classificationSchema", () => {
  it("accepts a well-formed bilingual payload", () => {
    const result = classificationSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("rejects unknown category slugs", () => {
    const result = classificationSchema.safeParse({ ...validPayload, category_slug: "crypto" });
    expect(result.success).toBe(false);
  });

  it("rejects relevance scores out of [0,1]", () => {
    const result = classificationSchema.safeParse({ ...validPayload, relevance_score: 1.5 });
    expect(result.success).toBe(false);
  });

  it("rejects too-short summaries", () => {
    const result = classificationSchema.safeParse({ ...validPayload, summary_es: "tiny" });
    expect(result.success).toBe(false);
  });

  it("rejects missing language-specific field", () => {
    const { title_en, ...rest } = validPayload;
    void title_en;
    const result = classificationSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("covers all known canonical slugs", () => {
    expect(CATEGORY_SLUGS).toContain("llm");
    expect(CATEGORY_SLUGS).toContain("other");
    expect(new Set(CATEGORY_SLUGS).size).toBe(CATEGORY_SLUGS.length);
  });
});

describe("classifyArticle", () => {
  it("returns parsed classification and usage on valid response", async () => {
    const client = makeClient(validPayload);

    const result = await classifyArticle(sampleArticle, { client, model: "test-model" });

    expect(result.classification.category_slug).toBe("llm");
    expect(result.classification.title_es).toMatch(/GPT-5/);
    expect(result.classification.title_en).toMatch(/GPT-5/);
    expect(result.usage.totalTokens).toBe(140);
    expect(result.model).toBe("test-model");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("throws when the response is empty", async () => {
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => ({ choices: [{ message: { content: null } }] })),
        },
      },
    } as never;
    await expect(classifyArticle(sampleArticle, { client })).rejects.toThrow(/empty/i);
  });

  it("throws when the content is not JSON", async () => {
    const client = makeClient("not-json-at-all");
    await expect(classifyArticle(sampleArticle, { client })).rejects.toThrow(/non-JSON/i);
  });

  it("throws when the schema validation fails", async () => {
    const client = makeClient({ ...validPayload, category_slug: "not-a-slug" });
    await expect(classifyArticle(sampleArticle, { client })).rejects.toThrow(/Schema validation/i);
  });
});

describe("runClassify", () => {
  it("classifies a batch and writes bilingual results", async () => {
    const pending = [
      {
        id: "a1",
        title: "GPT-5 lands",
        url: "https://example.com/1",
        rawExcerpt: "Some content",
        imageUrl: null,
        language: "en" as const,
        sourceName: "Example",
        sourceLanguage: "en" as const,
      },
      {
        id: "a2",
        title: "Nuevo modelo open source",
        url: "https://example.com/2",
        rawExcerpt: "Texto en español",
        imageUrl: null,
        language: "es" as const,
        sourceName: "Xataka",
        sourceLanguage: "es" as const,
      },
    ];

    const client = makeClient(validPayload);

    const onClassified = vi.fn(async () => {});
    const onFailed = vi.fn(async () => {});

    const summary = await runClassify({
      client,
      model: "test",
      fetchPending: async () => pending,
      onClassified,
      onFailed,
      resolveCategoryId: async () => "cat-id",
      // These tests exercise the classify pipeline, not dedupe — bypass
      // the recents fetch so we don't hit the (mocked-out) DB layer.
      dedupeEnabled: false,
    });

    expect(summary.processed).toBe(2);
    expect(summary.classified).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.tokens.total).toBe(280);
    expect(onClassified).toHaveBeenCalledTimes(2);
    expect(onClassified).toHaveBeenCalledWith(
      "a1",
      expect.objectContaining({
        categoryId: "cat-id",
        titleEs: validPayload.title_es,
        titleEn: validPayload.title_en,
        summaryEs: validPayload.summary_es,
        summaryEn: validPayload.summary_en,
      }),
    );
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("marks article failed on invalid LLM output", async () => {
    const pending = [
      {
        id: "a1",
        title: "T",
        url: "https://example.com/1",
        rawExcerpt: null,
        imageUrl: null,
        language: "en" as const,
        sourceName: "Example",
        sourceLanguage: "en" as const,
      },
    ];

    const client = makeClient("garbage");
    const onClassified = vi.fn(async () => {});
    const onFailed = vi.fn(async () => {});

    const summary = await runClassify({
      client,
      fetchPending: async () => pending,
      onClassified,
      onFailed,
      resolveCategoryId: async () => "cat-id",
      // These tests exercise the classify pipeline, not dedupe — bypass
      // the recents fetch so we don't hit the (mocked-out) DB layer.
      dedupeEnabled: false,
    });

    expect(summary.classified).toBe(0);
    expect(summary.failed).toBe(1);
    expect(onClassified).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith("a1", expect.stringMatching(/non-JSON/i));
  });

  it("treats SDK timeouts as transient — does NOT mark article failed", async () => {
    // When the OpenAI SDK aborts a request due to its per-call
    // timeout, it throws APIConnectionTimeoutError. We must NOT call
    // onFailed for those: marking the article terminally `failed`
    // would prevent the next cron tick from retrying it. The article
    // should stay in `pending` and surface in the summary's
    // `timedOut` counter.
    const pending = [
      {
        id: "a1",
        title: "Slow",
        url: "https://example.com/1",
        rawExcerpt: null,
        imageUrl: null,
        language: "en" as const,
        sourceName: "Example",
        sourceLanguage: "en" as const,
      },
    ];

    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            throw new APIConnectionTimeoutError({ message: "Request timed out" });
          }),
        },
      },
    } as never;

    const onClassified = vi.fn(async () => {});
    const onFailed = vi.fn(async () => {});

    const summary = await runClassify({
      client,
      fetchPending: async () => pending,
      onClassified,
      onFailed,
      resolveCategoryId: async () => "cat-id",
      // These tests exercise the classify pipeline, not dedupe — bypass
      // the recents fetch so we don't hit the (mocked-out) DB layer.
      dedupeEnabled: false,
    });

    expect(summary.timedOut).toBe(1);
    expect(summary.failed).toBe(0);
    expect(summary.classified).toBe(0);
    expect(summary.processed).toBe(1);
    expect(onFailed).not.toHaveBeenCalled();
    expect(onClassified).not.toHaveBeenCalled();
  });

  it.each([
    [
      "429 RateLimitError (Cerebras TPM throttle)",
      () => new RateLimitError(429, { error: { message: "rate_limit_exceeded" } }, "rate_limit_exceeded", {}),
    ],
    [
      "5xx InternalServerError (provider hiccup)",
      () => new InternalServerError(503, { error: { message: "upstream" } }, "service_unavailable", {}),
    ],
    [
      "APIConnectionError (DNS/TCP)",
      () => new APIConnectionError({ message: "ECONNRESET" }),
    ],
  ])(
    "treats %s as transient — does NOT mark article failed",
    async (_label, makeError) => {
      // Regression for the 504-loop bug: before #N, a single throttled or
      // 5xx Cerebras call was caught here as a terminal failure and the
      // article was marked `failed`. Next cron tick skipped it. Now we
      // treat 429 / 5xx / connection-errors the same as a timeout: the
      // article stays `pending` and the next franja retries it.
      const pending = [
        {
          id: "a1",
          title: "Throttled article",
          url: "https://example.com/1",
          rawExcerpt: null,
          imageUrl: null,
          language: "en" as const,
          sourceName: "Example",
          sourceLanguage: "en" as const,
        },
      ];
      const client = {
        chat: {
          completions: {
            create: vi.fn(async () => {
              throw makeError();
            }),
          },
        },
      } as never;
      const onClassified = vi.fn(async () => {});
      const onFailed = vi.fn(async () => {});

      const summary = await runClassify({
        client,
        fetchPending: async () => pending,
        onClassified,
        onFailed,
        resolveCategoryId: async () => "cat-id",
        dedupeEnabled: false,
      });

      expect(summary.timedOut).toBe(1);
      expect(summary.failed).toBe(0);
      expect(onFailed).not.toHaveBeenCalled();
      expect(onClassified).not.toHaveBeenCalled();
    },
  );

  it("stops cleanly when the wall-clock budget is exhausted", async () => {
    // Six pending items, but every classification call sleeps 80ms.
    // With a 250ms total budget and a 9_000ms-per-iteration headroom
    // check, the loop bails *before* even the first iteration (the
    // headroom check fails on entry). That confirms the early-exit
    // path runs and the summary reports `budgetExhausted: true`
    // with no spurious failures.
    const pending = Array.from({ length: 6 }, (_, i) => ({
      id: `a${i}`,
      title: `T${i}`,
      url: `https://example.com/${i}`,
      rawExcerpt: null,
      imageUrl: null,
      language: "en" as const,
      sourceName: "Example",
      sourceLanguage: "en" as const,
    }));

    const client = makeClient(validPayload);
    const onClassified = vi.fn(async () => {});
    const onFailed = vi.fn(async () => {});

    const summary = await runClassify({
      client,
      fetchPending: async () => pending,
      onClassified,
      onFailed,
      resolveCategoryId: async () => "cat-id",
      maxWallTimeMs: 250,
      dedupeEnabled: false,
    });

    expect(summary.budgetExhausted).toBe(true);
    // No items attempted: the headroom check is 9_000ms and the
    // budget is 250ms, so the loop exits before iteration 0.
    expect(summary.processed).toBe(0);
    expect(summary.classified).toBe(0);
    expect(summary.failed).toBe(0);
    expect(onClassified).not.toHaveBeenCalled();
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("fails the article when the category slug is unknown to the DB", async () => {
    const pending = [
      {
        id: "a1",
        title: "T",
        url: "https://example.com/1",
        rawExcerpt: null,
        imageUrl: null,
        language: "en" as const,
        sourceName: "Example",
        sourceLanguage: "en" as const,
      },
    ];

    const client = makeClient(validPayload);

    const onClassified = vi.fn(async () => {});
    const onFailed = vi.fn(async () => {});

    const summary = await runClassify({
      client,
      fetchPending: async () => pending,
      onClassified,
      onFailed,
      resolveCategoryId: async () => undefined,
      dedupeEnabled: false,
    });

    expect(summary.classified).toBe(0);
    expect(summary.failed).toBe(1);
    expect(onFailed).toHaveBeenCalledWith("a1", expect.stringMatching(/Unknown category/i));
  });
});

describe("runClassify · content-level dedupe", () => {
  it("marks an article as hidden when its ES title duplicates a recent one", async () => {
    // First article in the cluster: "Elon Musk pierde el juicio por OpenAI"
    // (already classified, lives in `recents`). New incoming article from
    // a different source phrases the same event differently.
    const pending = [
      {
        id: "wired",
        title: "Elon Musk Loses Historic OpenAI Lawsuit",
        url: "https://wired.com/x",
        rawExcerpt: "Same case, different publisher.",
        imageUrl: null,
        language: "en" as const,
        sourceName: "Wired",
        sourceLanguage: "en" as const,
      },
    ];
    const newPayload = {
      ...validPayload,
      title_es: "Elon Musk pierde un juicio histórico contra OpenAI",
      title_en: "Elon Musk loses historic OpenAI lawsuit",
    };
    const client = makeClient(newPayload);
    const onClassified = vi.fn(async () => {});
    const onFailed = vi.fn(async () => {});
    const onHiddenAsDuplicate = vi.fn(async () => {});

    const summary = await runClassify({
      client,
      fetchPending: async () => pending,
      onClassified,
      onFailed,
      resolveCategoryId: async () => "cat-id",
      fetchRecentForDedupe: async () => [
        { id: "ars", titleEs: "Elon Musk pierde el juicio por acusar a OpenAI de robar una caridad", imageUrl: null, isClassified: true },
      ],
      onHiddenAsDuplicate,
    });

    expect(summary.classified).toBe(0);
    expect(summary.dedupedHidden).toBe(1);
    expect(summary.processed).toBe(1);
    expect(onClassified).not.toHaveBeenCalled();
    expect(onHiddenAsDuplicate).toHaveBeenCalledOnce();
    expect(onHiddenAsDuplicate).toHaveBeenCalledWith(
      "wired",
      expect.objectContaining({ titleEs: newPayload.title_es }),
      expect.objectContaining({
        matchedId: "ars",
        similarity: expect.any(Number),
      }),
    );
  });

  it("classifies normally when no recent matches above threshold", async () => {
    const pending = [
      {
        id: "unique",
        title: "Apple Intelligence ships on iPhone 17",
        url: "https://apple.com/x",
        rawExcerpt: "...",
        imageUrl: null,
        language: "en" as const,
        sourceName: "Apple Newsroom",
        sourceLanguage: "en" as const,
      },
    ];
    const client = makeClient(validPayload);
    const onClassified = vi.fn(async () => {});
    const onHiddenAsDuplicate = vi.fn(async () => {});

    const summary = await runClassify({
      client,
      fetchPending: async () => pending,
      onClassified,
      onFailed: vi.fn(async () => {}),
      resolveCategoryId: async () => "cat-id",
      fetchRecentForDedupe: async () => [
        { id: "old", titleEs: "Google DeepMind anuncia un modelo de robótica", imageUrl: null, isClassified: true },
      ],
      onHiddenAsDuplicate,
    });

    expect(summary.classified).toBe(1);
    expect(summary.dedupedHidden).toBe(0);
    expect(onClassified).toHaveBeenCalledOnce();
    expect(onHiddenAsDuplicate).not.toHaveBeenCalled();
  });

  it("dedupes the second article of a cluster arriving in the same tick (in-memory recents)", async () => {
    // No DB-side recents. Two articles in the same batch about the same
    // event. The first should classify, the second should be hidden
    // against the first via the in-memory `recents.push(...)` update.
    const pending = [
      {
        id: "first",
        title: "First headline about Musk losing the OpenAI suit",
        url: "https://example.com/first",
        rawExcerpt: "...",
        imageUrl: null,
        language: "en" as const,
        sourceName: "First",
        sourceLanguage: "en" as const,
      },
      {
        id: "second",
        title: "Second headline about the same Musk OpenAI verdict",
        url: "https://example.com/second",
        rawExcerpt: "...",
        imageUrl: null,
        language: "en" as const,
        sourceName: "Second",
        sourceLanguage: "en" as const,
      },
    ];
    // The LLM "translates" both to near-identical ES titles.
    const calls = [
      {
        ...validPayload,
        title_es: "Elon Musk pierde su juicio contra OpenAI por una caridad",
      },
      {
        ...validPayload,
        title_es: "Elon Musk pierde el juicio contra OpenAI",
      },
    ];
    let callIdx = 0;
    const client = {
      chat: {
        completions: {
          create: vi.fn(async () => ({
            choices: [{ message: { content: JSON.stringify(calls[callIdx++]) } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })),
        },
      },
    } as never;
    const onClassified = vi.fn(async () => {});
    const onHiddenAsDuplicate = vi.fn(async () => {});

    const summary = await runClassify({
      client,
      fetchPending: async () => pending,
      onClassified,
      onFailed: vi.fn(async () => {}),
      resolveCategoryId: async () => "cat-id",
      fetchRecentForDedupe: async () => [],
      onHiddenAsDuplicate,
    });

    expect(summary.classified).toBe(1);
    expect(summary.dedupedHidden).toBe(1);
    expect(onClassified).toHaveBeenCalledOnce();
    expect(onClassified).toHaveBeenCalledWith("first", expect.any(Object));
    expect(onHiddenAsDuplicate).toHaveBeenCalledOnce();
    expect(onHiddenAsDuplicate).toHaveBeenCalledWith(
      "second",
      expect.any(Object),
      expect.objectContaining({ matchedId: "first" }),
    );
  });

  it("counts LLM tokens for hidden articles too (the call already happened)", async () => {
    const pending = [
      {
        id: "dup",
        title: "Duplicate",
        url: "https://example.com/dup",
        rawExcerpt: "...",
        imageUrl: null,
        language: "en" as const,
        sourceName: "Source",
        sourceLanguage: "en" as const,
      },
    ];
    const payload = { ...validPayload, title_es: "Elon Musk pierde el juicio contra OpenAI" };
    const client = makeClient(payload, {
      prompt_tokens: 50,
      completion_tokens: 25,
      total_tokens: 75,
    });

    const summary = await runClassify({
      client,
      fetchPending: async () => pending,
      onClassified: vi.fn(async () => {}),
      onFailed: vi.fn(async () => {}),
      resolveCategoryId: async () => "cat-id",
      fetchRecentForDedupe: async () => [
        { id: "ars", titleEs: "Elon Musk pierde el juicio por acusar a OpenAI de robar una caridad", imageUrl: null, isClassified: true },
      ],
      onHiddenAsDuplicate: vi.fn(async () => {}),
    });

    // Tokens must always be billed — the LLM call ran regardless of dedupe.
    expect(summary.tokens.total).toBe(75);
    expect(summary.dedupedHidden).toBe(1);
  });
});

describe("runClassify · prefer near-duplicates that carry an image", () => {
  // Shared cluster fixture: the candidate's ES title is similar enough
  // to the existing winner's that Jaccard ≥ 0.4 fires regardless of
  // the image criterion. The four specs only differ in who has the
  // image, so they exercise the image branch in isolation.
  const candidateLlmPayload = {
    ...validPayload,
    title_es: "Elon Musk pierde un juicio histórico contra OpenAI",
  };
  const ORIGINAL_TITLE_ES =
    "Elon Musk pierde el juicio por acusar a OpenAI de robar una caridad";

  function buildPendingCandidate(imageUrl: string | null) {
    return [
      {
        id: "wired",
        title: "Elon Musk Loses Historic OpenAI Lawsuit",
        url: "https://wired.com/x",
        rawExcerpt: "Same case, different publisher.",
        imageUrl,
        language: "en" as const,
        sourceName: "Wired",
        sourceLanguage: "en" as const,
      },
    ];
  }

  it("REPLACE: candidate has image, original doesn't → swap winner", async () => {
    const onClassified = vi.fn(async () => {});
    const onHiddenAsDuplicate = vi.fn(async () => {});
    const onClassifiedReplacingDuplicate = vi.fn(async () => {});

    const summary = await runClassify({
      client: makeClient(candidateLlmPayload),
      fetchPending: async () => buildPendingCandidate("https://cdn.example/cover.jpg"),
      onClassified,
      onFailed: vi.fn(async () => {}),
      resolveCategoryId: async () => "cat-id",
      fetchRecentForDedupe: async () => [
        { id: "ars", titleEs: ORIGINAL_TITLE_ES, imageUrl: null, isClassified: true },
      ],
      onHiddenAsDuplicate,
      onClassifiedReplacingDuplicate,
    });

    // Swap fired: dedupedReplaced=1, dedupedHidden=0, classified=1.
    expect(summary.dedupedReplaced).toBe(1);
    expect(summary.dedupedHidden).toBe(0);
    expect(summary.classified).toBe(1);
    expect(onClassified).not.toHaveBeenCalled();
    expect(onHiddenAsDuplicate).not.toHaveBeenCalled();
    expect(onClassifiedReplacingDuplicate).toHaveBeenCalledOnce();
    expect(onClassifiedReplacingDuplicate).toHaveBeenCalledWith(
      "wired",
      expect.objectContaining({ titleEs: candidateLlmPayload.title_es }),
      expect.objectContaining({ matchedId: "ars" }),
    );
  });

  it("HIDE: original has image, candidate doesn't → existing FIFO path", async () => {
    const onClassified = vi.fn(async () => {});
    const onHiddenAsDuplicate = vi.fn(async () => {});
    const onClassifiedReplacingDuplicate = vi.fn(async () => {});

    const summary = await runClassify({
      client: makeClient(candidateLlmPayload),
      fetchPending: async () => buildPendingCandidate(null),
      onClassified,
      onFailed: vi.fn(async () => {}),
      resolveCategoryId: async () => "cat-id",
      fetchRecentForDedupe: async () => [
        { id: "ars", titleEs: ORIGINAL_TITLE_ES, imageUrl: "https://cdn.example/ars.jpg", isClassified: true },
      ],
      onHiddenAsDuplicate,
      onClassifiedReplacingDuplicate,
    });

    expect(summary.dedupedReplaced).toBe(0);
    expect(summary.dedupedHidden).toBe(1);
    expect(summary.classified).toBe(0);
    expect(onHiddenAsDuplicate).toHaveBeenCalledOnce();
    expect(onClassifiedReplacingDuplicate).not.toHaveBeenCalled();
  });

  it("HIDE: both have images → FIFO (original wins)", async () => {
    const onHiddenAsDuplicate = vi.fn(async () => {});
    const onClassifiedReplacingDuplicate = vi.fn(async () => {});

    const summary = await runClassify({
      client: makeClient(candidateLlmPayload),
      fetchPending: async () => buildPendingCandidate("https://cdn.example/wired.jpg"),
      onClassified: vi.fn(async () => {}),
      onFailed: vi.fn(async () => {}),
      resolveCategoryId: async () => "cat-id",
      fetchRecentForDedupe: async () => [
        { id: "ars", titleEs: ORIGINAL_TITLE_ES, imageUrl: "https://cdn.example/ars.jpg", isClassified: true },
      ],
      onHiddenAsDuplicate,
      onClassifiedReplacingDuplicate,
    });

    expect(summary.dedupedReplaced).toBe(0);
    expect(summary.dedupedHidden).toBe(1);
    expect(onClassifiedReplacingDuplicate).not.toHaveBeenCalled();
  });

  it("HIDE: neither has images → FIFO (original wins)", async () => {
    const onHiddenAsDuplicate = vi.fn(async () => {});
    const onClassifiedReplacingDuplicate = vi.fn(async () => {});

    const summary = await runClassify({
      client: makeClient(candidateLlmPayload),
      fetchPending: async () => buildPendingCandidate(null),
      onClassified: vi.fn(async () => {}),
      onFailed: vi.fn(async () => {}),
      resolveCategoryId: async () => "cat-id",
      fetchRecentForDedupe: async () => [
        { id: "ars", titleEs: ORIGINAL_TITLE_ES, imageUrl: null, isClassified: true },
      ],
      onHiddenAsDuplicate,
      onClassifiedReplacingDuplicate,
    });

    expect(summary.dedupedReplaced).toBe(0);
    expect(summary.dedupedHidden).toBe(1);
    expect(onClassifiedReplacingDuplicate).not.toHaveBeenCalled();
  });

  it("HIDE: candidate has image but the existing match is already hidden → do NOT resurrect", async () => {
    // Edge case: the dedupe query returns hidden rows too (so a third
    // source can match the previous duplicate of the same cluster).
    // We must NOT promote a candidate over a *hidden* row — that would
    // leave the cluster with two visible rows (the original classified
    // winner AND the new one) once the hidden's predecessor is taken
    // into account.
    const onHiddenAsDuplicate = vi.fn(async () => {});
    const onClassifiedReplacingDuplicate = vi.fn(async () => {});

    const summary = await runClassify({
      client: makeClient(candidateLlmPayload),
      fetchPending: async () => buildPendingCandidate("https://cdn.example/wired.jpg"),
      onClassified: vi.fn(async () => {}),
      onFailed: vi.fn(async () => {}),
      resolveCategoryId: async () => "cat-id",
      fetchRecentForDedupe: async () => [
        { id: "ars-hidden", titleEs: ORIGINAL_TITLE_ES, imageUrl: null, isClassified: false },
      ],
      onHiddenAsDuplicate,
      onClassifiedReplacingDuplicate,
    });

    expect(summary.dedupedReplaced).toBe(0);
    expect(summary.dedupedHidden).toBe(1);
    expect(onClassifiedReplacingDuplicate).not.toHaveBeenCalled();
  });
});

describe("runClassify · is_ai_related gate (Phase 8.B)", () => {
  // Hipertextual-style noise: an article that classifies cleanly (the
  // LLM still picks a slug to keep the schema happy) but with
  // `is_ai_related: false`. The orchestrator must hide it instead of
  // counting it as classified, AND must skip the dedupe pass — non-AI
  // rows have no business polluting the recents window.
  const nonAiPayload = {
    ...validPayload,
    category_slug: "other" as const,
    is_ai_related: false,
    relevance_score: 0.1,
    title_es: "XPPen lanza una nueva consola con pantalla LCD",
    title_en: "XPPen launches a new console with LCD display",
    summary_es:
      "La compañía anuncia un dispositivo orientado al dibujo digital sin relación con IA.",
    summary_en:
      "The company announces a drawing-focused device without any AI angle.",
  };

  const samplePending = [
    {
      id: "noise",
      title: "XPPen unveils new drawing console",
      url: "https://hipertextual.com/brands/consola-edicion-xppen",
      rawExcerpt: "LCD specs, pen pressure, no AI mentioned.",
      imageUrl: null,
      language: "es" as const,
      sourceName: "Hipertextual",
      sourceLanguage: "es" as const,
    },
  ];

  it("hides a non-AI article and skips both onClassified and dedupe", async () => {
    const onClassified = vi.fn(async () => {});
    const onHiddenAsDuplicate = vi.fn(async () => {});
    const onHiddenAsNonAi = vi.fn(async () => {});

    const summary = await runClassify({
      client: makeClient(nonAiPayload),
      fetchPending: async () => samplePending,
      onClassified,
      onFailed: vi.fn(async () => {}),
      resolveCategoryId: async () => "cat-id",
      // Provide a recent that WOULD trip dedupe if the orchestrator
      // hadn't bailed first — proves we short-circuit before the
      // dedupe pass even runs.
      fetchRecentForDedupe: async () => [
        { id: "old", titleEs: "XPPen anuncia consola con pantalla LCD", imageUrl: null, isClassified: true },
      ],
      onHiddenAsDuplicate,
      onHiddenAsNonAi,
    });

    expect(summary.hiddenNonAi).toBe(1);
    expect(summary.classified).toBe(0);
    expect(summary.dedupedHidden).toBe(0);
    // `processed` includes the hidden-non-ai row — the LLM call ran.
    expect(summary.processed).toBe(1);
    expect(onClassified).not.toHaveBeenCalled();
    expect(onHiddenAsDuplicate).not.toHaveBeenCalled();
    expect(onHiddenAsNonAi).toHaveBeenCalledOnce();
    expect(onHiddenAsNonAi).toHaveBeenCalledWith(
      "noise",
      expect.objectContaining({
        categoryId: "cat-id",
        titleEs: nonAiPayload.title_es,
        relevanceScore: 0.1,
      }),
    );
  });

  it("still bills LLM tokens for a hidden-non-ai row (the call already happened)", async () => {
    const onHiddenAsNonAi = vi.fn(async () => {});
    const client = makeClient(nonAiPayload, {
      prompt_tokens: 70,
      completion_tokens: 30,
      total_tokens: 100,
    });

    const summary = await runClassify({
      client,
      fetchPending: async () => samplePending,
      onClassified: vi.fn(async () => {}),
      onFailed: vi.fn(async () => {}),
      resolveCategoryId: async () => "cat-id",
      dedupeEnabled: false,
      onHiddenAsNonAi,
    });

    expect(summary.tokens.total).toBe(100);
    expect(summary.hiddenNonAi).toBe(1);
  });

  it("classifies normally when is_ai_related is undefined (backward compat)", async () => {
    // Older cached responses don't carry the new flag. The orchestrator
    // must treat `undefined` as "no opinion" and let the article go
    // through the normal pipeline — otherwise re-running classify
    // against a Cerebras cache miss would bulk-hide history.
    const { is_ai_related: _drop, ...legacyPayload } = nonAiPayload;
    void _drop;
    // Fix the relevance back to something normal for this test.
    const payload = { ...legacyPayload, relevance_score: 0.9, category_slug: "llm" as const };

    const onClassified = vi.fn(async () => {});
    const onHiddenAsNonAi = vi.fn(async () => {});

    const summary = await runClassify({
      client: makeClient(payload),
      fetchPending: async () => samplePending,
      onClassified,
      onFailed: vi.fn(async () => {}),
      resolveCategoryId: async () => "cat-id",
      dedupeEnabled: false,
      onHiddenAsNonAi,
    });

    expect(summary.classified).toBe(1);
    expect(summary.hiddenNonAi).toBe(0);
    expect(onClassified).toHaveBeenCalledOnce();
    expect(onHiddenAsNonAi).not.toHaveBeenCalled();
  });

  it("schema accepts is_ai_related true/false/absent (back-compat)", () => {
    const cases = [
      { ...validPayload, is_ai_related: true },
      { ...validPayload, is_ai_related: false },
      validPayload, // absent — undefined
    ];
    for (const c of cases) {
      const parsed = classificationSchema.safeParse(c);
      expect(parsed.success).toBe(true);
    }
  });
});
