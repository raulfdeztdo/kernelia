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
});

export type Classification = z.infer<typeof classificationSchema>;
