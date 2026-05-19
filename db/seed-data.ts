import type { NewCategory, NewSource } from "./schema";

export const seedCategories: ReadonlyArray<Omit<NewCategory, "id" | "createdAt">> = [
  { slug: "llm", nameEs: "Modelos de lenguaje", nameEn: "Language models" },
  { slug: "agents", nameEs: "Agentes", nameEn: "Agents" },
  { slug: "research", nameEs: "Investigación", nameEn: "Research" },
  { slug: "products", nameEs: "Productos", nameEn: "Products" },
  { slug: "robotics", nameEs: "Robótica", nameEn: "Robotics" },
  { slug: "policy", nameEs: "Regulación y política", nameEn: "Policy & regulation" },
  { slug: "safety", nameEs: "Seguridad y alineamiento", nameEn: "Safety & alignment" },
  { slug: "multimodal", nameEs: "Multimodal", nameEn: "Multimodal" },
  { slug: "coding", nameEs: "IA para programar", nameEn: "Coding AI" },
  { slug: "other", nameEs: "Otros", nameEn: "Other" },
];

export const seedSources: ReadonlyArray<Omit<NewSource, "id" | "createdAt">> = [
  {
    name: "TechCrunch AI",
    url: "https://techcrunch.com/category/artificial-intelligence/",
    rssUrl: "https://techcrunch.com/category/artificial-intelligence/feed/",
    language: "en",
    active: true,
  },
  {
    name: "The Verge — AI",
    url: "https://www.theverge.com/ai-artificial-intelligence",
    rssUrl: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    language: "en",
    active: true,
  },
  {
    name: "MIT Technology Review",
    url: "https://www.technologyreview.com/",
    rssUrl: "https://www.technologyreview.com/feed/",
    language: "en",
    active: true,
  },
  {
    name: "VentureBeat AI",
    url: "https://venturebeat.com/category/ai/",
    rssUrl: "https://venturebeat.com/category/ai/feed/",
    language: "en",
    active: true,
  },
  {
    name: "Hugging Face Blog",
    url: "https://huggingface.co/blog",
    rssUrl: "https://huggingface.co/blog/feed.xml",
    language: "en",
    active: true,
  },
  {
    name: "Google DeepMind Blog",
    url: "https://deepmind.google/discover/blog/",
    rssUrl: "https://deepmind.google/blog/rss.xml",
    language: "en",
    active: true,
  },
  {
    name: "Ars Technica — AI",
    url: "https://arstechnica.com/ai/",
    rssUrl: "https://arstechnica.com/ai/feed/",
    language: "en",
    active: true,
  },
  {
    name: "Wired — AI",
    url: "https://www.wired.com/tag/artificial-intelligence/",
    rssUrl: "https://www.wired.com/feed/tag/ai/latest/rss",
    language: "en",
    active: true,
  },
  {
    name: "Xataka",
    url: "https://www.xataka.com/categoria/inteligencia-artificial",
    rssUrl: "https://www.xataka.com/categoria/inteligencia-artificial/rss2.xml",
    language: "es",
    active: true,
  },
  {
    name: "Genbeta — IA",
    url: "https://www.genbeta.com/categoria/inteligencia-artificial",
    rssUrl: "https://www.genbeta.com/categoria/inteligencia-artificial/rss2.xml",
    language: "es",
    active: true,
  },
  {
    // General tech feed (no AI-specific tag survives: the obvious
    // `/tag/inteligencia-artificial/feed` 410s). We accept the noise of
    // non-AI items (cinema, Apple gadgets, etc.) because the classifier
    // already filters by `category_slug` and assigns a low
    // `relevance_score` to anything off-topic. Net: we still pick up the
    // AI pieces this site does well, at the cost of a few extra LLM
    // tokens per ingest tick.
    name: "Hipertextual",
    url: "https://hipertextual.com/",
    rssUrl: "https://hipertextual.com/feed",
    language: "es",
    active: true,
  },
  {
    name: "Maldita Tecnología",
    url: "https://maldita.es/malditatecnologia/",
    rssUrl: "https://maldita.es/malditatecnologia/feed/",
    language: "es",
    active: true,
  },
  {
    // Primary source for OpenAI launches / Codex / product news. Lower
    // cadence than the press (1-3 posts/week typically) so the volume
    // impact on the ingest tick is small. Anthropic's news page has no
    // public RSS — they're covered indirectly via Wired / Ars / TC.
    name: "OpenAI News",
    url: "https://openai.com/news/",
    rssUrl: "https://openai.com/news/rss.xml",
    language: "en",
    active: true,
  },
  {
    // The Keyword's AI sub-feed: Gemini / Workspace AI / Cloud AI
    // announcements. Distinct from DeepMind, which is research-heavy.
    name: "Google AI Blog",
    url: "https://blog.google/technology/ai/",
    rssUrl: "https://blog.google/technology/ai/rss/",
    language: "en",
    active: true,
  },
  {
    // Replaces the old `blogs.microsoft.com/ai` feed, which has been
    // dormant since 2022. Microsoft Research is the lab arm and covers
    // AI alongside other CS topics; the classifier will skip the
    // non-AI items the same way it does with Hipertextual.
    name: "Microsoft Research",
    url: "https://www.microsoft.com/en-us/research/",
    rssUrl: "https://www.microsoft.com/en-us/research/feed/",
    language: "en",
    active: true,
  },
];
