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

/**
 * Cerebras Llama occasionally returns `is_ai_related` as a string
 * (`"true"` / `"false"`) instead of a JSON boolean — pure model
 * unpredictability that Hipertextual's noisy feed reproduces almost
 * every tick. Coerce the obvious cases on the way in so a clean
 * `false` (the gating signal) still reaches the orchestrator instead
 * of failing schema validation and pushing the row to `failed`.
 *
 * Truthy strings ("true", "yes", "1") → `true`; falsy strings ("false",
 * "no", "0", "") → `false`; anything else stays as-is and the next
 * `z.boolean()` step will reject it (preserves loud-failure on
 * genuinely-malformed payloads).
 */
const aiRelatedFlexible = z.preprocess((v) => {
  if (typeof v !== "string") return v;
  const s = v.trim().toLowerCase();
  if (s === "true" || s === "yes" || s === "1") return true;
  if (s === "false" || s === "no" || s === "0" || s === "") return false;
  return v;
}, z.boolean().optional());

/**
 * Cerebras Llama 3.1 in `response_format: json_object` mode occasionally
 * emits broken `\uXXXX` escapes for Spanish accented characters: instead
 * of `ó` for `ó` it produces escapes like \u0015, \u001B, etc.
 * After `JSON.parse` those become literal C0 control characters embedded
 * in the title/summary, which then render as tofu glyphs in the
 * newsletter and have no recoverable original (the substituted codepoints
 * are non-deterministic across runs).
 *
 * The only safe move is to detect them and fail the classification —
 * the orchestrator marks the article `failed`, it stays out of every
 * public surface, and `/admin/articles` shows the issue.
 *
 * We tolerate \t (U+0009), \n (U+000A), \r (U+000D) only — newlines in
 * summaries do happen legitimately when the model formats multi-line
 * blurbs. Everything else in U+0000..U+001F and U+007F..U+009F is
 * rejected. Written with explicit \u escapes so the source file stays
 * free of the very chars we're guarding against.
 */
const CONTROL_CHAR_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;

const noControlCharsString = (label: string) =>
  z.string().refine(
    (s) => !CONTROL_CHAR_RE.test(s),
    {
      message: `${label} contains C0/C1 control characters (broken LLM unicode escapes)`,
    },
  );

/**
 * Title min length is relaxed to 1: some Hipertextual items come back
 * with a 1-2 character translation when the source title is a single
 * word ("X", "Q*") and Cerebras refuses to pad it. The orchestrator
 * downgrades anything shorter than 3 to `is_ai_related: false` so
 * these rows still get hidden cleanly — see `lib/ai/run.ts` for the
 * post-parse normalisation.
 */
export const classificationSchema = z.object({
  category_slug: z.enum(CATEGORY_SLUGS),
  title_es: noControlCharsString("title_es").pipe(z.string().min(1).max(300)),
  title_en: noControlCharsString("title_en").pipe(z.string().min(1).max(300)),
  summary_es: noControlCharsString("summary_es").pipe(z.string().min(20).max(600)),
  summary_en: noControlCharsString("summary_en").pipe(z.string().min(20).max(600)),
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
  is_ai_related: aiRelatedFlexible,
});

/**
 * Minimum title length we'll actually publish. Anything shorter than
 * this is treated as a malformed LLM response and gets hidden under
 * the `non_ai` tag instead of failing the row — see `lib/ai/run.ts`.
 */
export const MIN_PUBLISHABLE_TITLE_LENGTH = 3;

export type Classification = z.infer<typeof classificationSchema>;
