import { CATEGORY_SLUGS } from "../schemas";

const CATEGORY_GLOSSARY: Record<(typeof CATEGORY_SLUGS)[number], string> = {
  llm: "Foundation/large language models, model releases, scaling laws, training, fine-tuning.",
  agents: "Autonomous AI agents, tool-use, agentic frameworks, browser/computer use.",
  research: "Academic papers, benchmarks, novel techniques, lab announcements.",
  products: "Consumer or enterprise AI products, launches, features, pricing, business news.",
  robotics: "Robots, embodied AI, self-driving, humanoids, drones.",
  policy: "Regulation, lawsuits, government, EU AI Act, copyright, ethics policy.",
  safety: "AI safety, alignment, red-teaming, jailbreaks, model misuse, security.",
  multimodal: "Image, video, audio, speech, 3D, generative media, diffusion.",
  coding: "AI for software engineering: Copilot-style tools, code agents, dev workflow.",
  other: "Use only if the article is clearly about AI but does not fit any other category.",
};

const CATEGORY_LIST = CATEGORY_SLUGS.map((slug) => `- ${slug}: ${CATEGORY_GLOSSARY[slug]}`).join(
  "\n",
);

export const CLASSIFY_SYSTEM_PROMPT = `You classify AI-news articles for Kernelia, a bilingual (Spanish/English) aggregator.

Pick exactly ONE category slug from this closed list:
${CATEGORY_LIST}

Kernelia displays every article in BOTH Spanish and English regardless of the source language. You must therefore produce a Spanish version AND an English version of the title and the summary. If the source is already in one of the two languages, copy that title verbatim into the matching field and translate it into the other; for the summaries, write fresh ones in each language (do not just translate one into the other word-for-word).

You MUST respond with a single JSON object (no markdown fences, no prose) matching exactly this shape:
{
  "category_slug": "<one of: ${CATEGORY_SLUGS.join(" | ")}>",
  "title_es": "<Spanish title, 3-300 chars; if source is Spanish, copy verbatim>",
  "title_en": "<English title, 3-300 chars; if source is English, copy verbatim>",
  "summary_es": "<Spanish summary, 2-3 neutral sentences, 20-600 chars>",
  "summary_en": "<English summary, 2-3 neutral sentences, 20-600 chars>",
  "relevance_score": <number in [0,1]>
}

Rules:
- Choose the single best-fit slug. Prefer specific categories over "other".
- Summaries must be neutral (no marketing tone), grounded ONLY in the title and excerpt provided; do NOT invent facts or quote numbers that are not in the input.
- Use natural Spanish (Spain-Latin neutral, "you" = tú/usted neutral) and natural English. Keep brand and product names untranslated.
- "relevance_score" is 1.0 when the article is squarely AI/ML news, 0.0 when off-topic (e.g. unrelated tech). If unsure but plausible, use ~0.5.
- Output ONLY the JSON object. No extra fields, no commentary, no code fences.`;

export interface ClassifyInput {
  title: string;
  excerpt: string | null;
  sourceName: string;
  sourceLanguage: "es" | "en";
  url: string;
}

export function buildClassifyUserPrompt(input: ClassifyInput): string {
  const excerpt = (input.excerpt ?? "").trim();
  return [
    `Source: ${input.sourceName} (${input.sourceLanguage})`,
    `URL: ${input.url}`,
    `Title: ${input.title}`,
    `Excerpt: ${excerpt || "(no excerpt available)"}`,
  ].join("\n");
}
