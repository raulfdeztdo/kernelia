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
  title_es: z.string().min(3).max(300),
  title_en: z.string().min(3).max(300),
  summary_es: z.string().min(20).max(600),
  summary_en: z.string().min(20).max(600),
  relevance_score: z.coerce.number().min(0).max(1),
  /**
   * Hard AI-relevance gate. `false` means the article is NOT about AI
   * at all (gadget reviews, gaming news, generic tech leaks) and the
   * orchestrator should hide it instead of publishing it under "other".
   * Optional in the schema for backwards compatibility with older
   * cached responses — `undefined` is treated as `true` (no opinion).
   *
   * Added to stop noisy general-tech feeds (Hipertextual, Microsoft
   * Research, etc.) from spilling consumer gadget / PlayStation /
   * lifestyle items into Kernelia under the catch-all "other" slug.
   */
  is_ai_related: z.boolean().optional(),
});

export type Classification = z.infer<typeof classificationSchema>;
