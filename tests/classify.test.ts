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

const sampleArticle = {
  title: "OpenAI releases GPT-5 with agentic tool use",
  excerpt: "The new model can chain browser and file tools natively.",
  url: "https://example.com/a",
  sourceName: "Example",
  sourceLanguage: "en" as const,
};

describe("classificationSchema", () => {
  it("accepts a well-formed payload", () => {
    const result = classificationSchema.safeParse({
      category_slug: "llm",
      summary: "A solid 2-3 sentence summary with enough length.",
      language: "en",
      relevance_score: 0.9,
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown category slugs", () => {
    const result = classificationSchema.safeParse({
      category_slug: "crypto",
      summary: "A solid 2-3 sentence summary with enough length.",
      language: "en",
      relevance_score: 0.9,
    });
    expect(result.success).toBe(false);
  });

  it("rejects relevance scores out of [0,1]", () => {
    const result = classificationSchema.safeParse({
      category_slug: "llm",
      summary: "A solid 2-3 sentence summary with enough length.",
      language: "en",
      relevance_score: 1.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects too-short summaries", () => {
    const result = classificationSchema.safeParse({
      category_slug: "llm",
      summary: "tiny",
      language: "en",
      relevance_score: 0.5,
    });
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
    const client = makeClient({
      category_slug: "agents",
      summary: "OpenAI ships a new model with agentic capabilities and tool integration.",
      language: "en",
      relevance_score: 0.95,
    });

    const result = await classifyArticle(sampleArticle, { client, model: "test-model" });

    expect(result.classification.category_slug).toBe("agents");
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
    const client = makeClient({
      category_slug: "not-a-slug",
      summary: "ok summary long enough to pass length check.",
      language: "en",
      relevance_score: 0.5,
    });
    await expect(classifyArticle(sampleArticle, { client })).rejects.toThrow(/Schema validation/i);
  });
});

describe("runClassify", () => {
  it("classifies a batch and writes results", async () => {
    const pending = [
      {
        id: "a1",
        title: "GPT-5 lands",
        url: "https://example.com/1",
        rawExcerpt: "Some content",
        language: "en" as const,
        sourceName: "Example",
        sourceLanguage: "en" as const,
      },
      {
        id: "a2",
        title: "Nuevo modelo open source",
        url: "https://example.com/2",
        rawExcerpt: "Texto en español",
        language: "es" as const,
        sourceName: "Xataka",
        sourceLanguage: "es" as const,
      },
    ];

    const client = makeClient({
      category_slug: "llm",
      summary: "Two solid sentences worth of summary content for testing purposes.",
      language: "en",
      relevance_score: 0.9,
    });

    const onClassified = vi.fn(async () => {});
    const onFailed = vi.fn(async () => {});

    const summary = await runClassify({
      client,
      model: "test",
      fetchPending: async () => pending,
      onClassified,
      onFailed,
      resolveCategoryId: async () => "cat-id",
    });

    expect(summary.processed).toBe(2);
    expect(summary.classified).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.tokens.total).toBe(280);
    expect(onClassified).toHaveBeenCalledTimes(2);
    expect(onFailed).not.toHaveBeenCalled();
  });

  it("marks article failed on invalid LLM output", async () => {
    const pending = [
      {
        id: "a1",
        title: "T",
        url: "https://example.com/1",
        rawExcerpt: null,
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
    });

    expect(summary.classified).toBe(0);
    expect(summary.failed).toBe(1);
    expect(onClassified).not.toHaveBeenCalled();
    expect(onFailed).toHaveBeenCalledWith("a1", expect.stringMatching(/non-JSON/i));
  });

  it("fails the article when the category slug is unknown to the DB", async () => {
    const pending = [
      {
        id: "a1",
        title: "T",
        url: "https://example.com/1",
        rawExcerpt: null,
        language: "en" as const,
        sourceName: "Example",
        sourceLanguage: "en" as const,
      },
    ];

    const client = makeClient({
      category_slug: "llm",
      summary: "Two solid sentences worth of summary content for testing purposes.",
      language: "en",
      relevance_score: 0.9,
    });

    const onClassified = vi.fn(async () => {});
    const onFailed = vi.fn(async () => {});

    const summary = await runClassify({
      client,
      fetchPending: async () => pending,
      onClassified,
      onFailed,
      resolveCategoryId: async () => undefined,
    });

    expect(summary.classified).toBe(0);
    expect(summary.failed).toBe(1);
    expect(onFailed).toHaveBeenCalledWith("a1", expect.stringMatching(/Unknown category/i));
  });
});
