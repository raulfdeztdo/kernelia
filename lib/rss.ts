/**
 * Tiny RSS 2.0 builder. We don't need a full library here — the feed is
 * read-only and we control the input shape.
 */

import type { FeedArticle } from "@/db/queries/articles";

interface BuildFeedInput {
  title: string;
  description: string;
  siteUrl: string;
  selfUrl: string;
  language: "es" | "en";
  items: FeedArticle[];
}

/** RFC-1123 / RFC-822 date format required by RSS 2.0. */
function rfc822(date: Date): string {
  return date.toUTCString();
}

const RSS_LANG: Record<"es" | "en", string> = {
  es: "es-es",
  en: "en-us",
};

function xmlEscape(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(input: string): string {
  // Splits the closing sequence so the content is safe inside CDATA.
  const safe = input.replace(/]]>/g, "]]]]><![CDATA[>");
  return `<![CDATA[${safe}]]>`;
}

export function buildRssFeed(input: BuildFeedInput): string {
  const { title, description, siteUrl, selfUrl, language, items } = input;
  const lastBuildDate = items[0]?.publishedAt ?? new Date();

  const itemsXml = items
    .map((it) => {
      const summary = it.summary ?? "";
      const category = it.categorySlug ? `<category>${xmlEscape(it.categorySlug)}</category>` : "";
      return [
        "    <item>",
        `      <title>${cdata(it.title)}</title>`,
        `      <link>${xmlEscape(it.url)}</link>`,
        `      <guid isPermaLink="false">${xmlEscape(it.id)}</guid>`,
        `      <pubDate>${rfc822(it.publishedAt)}</pubDate>`,
        `      <source>${cdata(it.sourceName)}</source>`,
        category && `      ${category}`,
        `      <description>${cdata(summary)}</description>`,
        "    </item>",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${cdata(title)}</title>
    <link>${xmlEscape(siteUrl)}</link>
    <atom:link href="${xmlEscape(selfUrl)}" rel="self" type="application/rss+xml" />
    <description>${cdata(description)}</description>
    <language>${RSS_LANG[language]}</language>
    <lastBuildDate>${rfc822(lastBuildDate)}</lastBuildDate>
    <generator>Kernelia</generator>
${itemsXml}
  </channel>
</rss>`;
}
