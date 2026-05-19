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
  "relevance_score": <number in [0,1]>,
  "is_ai_related": <true | false>
}

Rules:
- "is_ai_related" is your STRICT relevance gate. Set it to false whenever the article is not clearly about artificial intelligence, machine learning, large language models, AI products, AI policy/safety, or AI research. Examples that MUST be false: generic gadget reviews (drawing tablets, monitors, e-readers), gaming or console news, smartphone leaks, streaming-service launches, social-media drama, generic cybersecurity incidents, business/finance news that merely mentions an AI vendor in passing, and any cinema, automotive (non-self-driving), lifestyle or sports content. Examples that MUST be true: model releases, new AI products or features, AI agent demos, robotics with learned policies, AI regulation, alignment/safety research, AI-for-coding tools.
- When in doubt — when AI is at most a side-mention, an analogy, or a 1-line aside — set is_ai_related to false. We prefer to drop a borderline AI article than to publish gadget/gaming noise.
- Choose the single best-fit slug. Prefer specific categories over "other". "other" is only for articles that ARE clearly about AI but don't fit any specific bucket. NEVER use "other" as a catch-all for non-AI content — use is_ai_related: false instead.
- Summaries must be neutral (no marketing tone), grounded ONLY in the title and excerpt provided; do NOT invent facts or quote numbers that are not in the input. You still produce ES + EN translations even when is_ai_related is false, so the operator can audit the decision in /admin/articles.
- Use natural Spanish (Spain-Latin neutral, "you" = tú/usted neutral) and natural English. Keep brand and product names untranslated.
- "relevance_score" is 1.0 when the article is squarely AI/ML news, 0.0 when off-topic (e.g. unrelated tech). If unsure but plausible, use ~0.5. When is_ai_related is false, relevance_score should be ≤ 0.2.
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
