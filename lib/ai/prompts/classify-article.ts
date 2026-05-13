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

export const CLASSIFY_SYSTEM_PROMPT = `You classify AI-news articles for Kernelia, a bilingual (ES/EN) aggregator.

Pick exactly ONE category slug from this closed list:
${CATEGORY_LIST}

You MUST respond with a single JSON object (no markdown fences, no prose) matching exactly this shape:
{
  "category_slug": "<one of: ${CATEGORY_SLUGS.join(" | ")}>",
  "summary": "<2-3 neutral sentences, 20-600 chars, in the SAME language as the article>",
  "language": "<'es' or 'en', matching the article language>",
  "relevance_score": <number in [0,1]>
}

Rules:
- Choose the single best-fit slug. Prefer specific categories over "other".
- Summary must be neutral (no marketing tone), grounded only in the title and excerpt provided; do NOT invent facts.
- "language" reflects the source article language, not the user's locale.
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
