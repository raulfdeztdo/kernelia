import { describe, expect, it } from "vitest";
import { buildRssFeed } from "@/lib/rss";

const items = [
  {
    id: "11111111-1111-1111-1111-111111111111",
    title: "GPT-5 lanza modo agentico",
    summary: "OpenAI presenta un modelo que orquesta herramientas de forma nativa.",
    url: "https://example.com/a?b=1&c=2",
    publishedAt: new Date("2026-05-14T10:00:00Z"),
    sourceName: "Example Source",
    categorySlug: "llm",
  },
  {
    id: "22222222-2222-2222-2222-222222222222",
    title: "Edge case <script>alert(1)</script> & co.",
    summary: null,
    url: "https://example.com/b",
    publishedAt: new Date("2026-05-13T08:30:00Z"),
    sourceName: "Other",
    categorySlug: null,
  },
];

describe("buildRssFeed", () => {
  const xml = buildRssFeed({
    title: "Kernelia — Noticias de IA",
    description: "Test feed",
    siteUrl: "https://kernelia.app",
    selfUrl: "https://kernelia.app/rss.xml?lang=es",
    language: "es",
    items,
  });

  it("declares a valid RSS 2.0 envelope", () => {
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain("<channel>");
    expect(xml).toContain("</channel>");
    expect(xml).toContain("</rss>");
  });

  it("includes channel metadata + atom self link", () => {
    expect(xml).toContain("<title><![CDATA[Kernelia — Noticias de IA]]></title>");
    expect(xml).toContain('<atom:link href="https://kernelia.app/rss.xml?lang=es"');
    expect(xml).toContain("<language>es-es</language>");
  });

  it("wraps every item's title in CDATA so HTML stays intact", () => {
    expect(xml).toContain("<![CDATA[Edge case <script>alert(1)</script> & co.]]>");
  });

  it("escapes raw ampersands inside link URLs", () => {
    expect(xml).toContain("<link>https://example.com/a?b=1&amp;c=2</link>");
  });

  it("emits a category element only when a slug is present", () => {
    const occurrences = xml.match(/<category>/g) ?? [];
    expect(occurrences.length).toBe(1);
    expect(xml).toContain("<category>llm</category>");
  });

  it("renders pubDate in RFC-822 format", () => {
    expect(xml).toContain("<pubDate>Thu, 14 May 2026 10:00:00 GMT</pubDate>");
  });
});
