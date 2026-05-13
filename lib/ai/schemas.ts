import { z } from "zod";

export const CATEGORY_SLUGS = [
  "llm",
  "agents",
  "research",
  "products",
  "robotics",
  "policy",
  "safety",
  "multimodal",
  "coding",
  "other",
] as const;

export type CategorySlug = (typeof CATEGORY_SLUGS)[number];

export const LANGUAGES = ["es", "en"] as const;
export type Language = (typeof LANGUAGES)[number];

export const classificationSchema = z.object({
  category_slug: z.enum(CATEGORY_SLUGS),
  summary: z.string().min(20).max(600),
  language: z.enum(LANGUAGES),
  relevance_score: z.number().min(0).max(1),
});

export type Classification = z.infer<typeof classificationSchema>;

/** JSON Schema literal sent to the LLM via `response_format: json_schema`. */
export const classificationJsonSchema = {
  name: "article_classification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      category_slug: {
        type: "string",
        enum: [...CATEGORY_SLUGS],
        description: "Slug of the most fitting Kernelia category.",
      },
      summary: {
        type: "string",
        minLength: 20,
        maxLength: 600,
        description:
          "Neutral 2-3 sentence summary written in the same language as `language`.",
      },
      language: {
        type: "string",
        enum: [...LANGUAGES],
        description: "Detected language of the source article (es or en).",
      },
      relevance_score: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description:
          "How relevant the article is to AI news (1 = clearly AI, 0 = off-topic).",
      },
    },
    required: ["category_slug", "summary", "language", "relevance_score"],
  },
} as const;
