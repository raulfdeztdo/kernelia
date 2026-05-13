import Parser from "rss-parser";
import type { Source } from "@/db/schema";
import { canonicalizeUrl, parseDate, plainTextExcerpt } from "./normalize";
import { urlHash } from "./dedupe";

export interface ParsedItem {
  url: string;
  urlHash: string;
  title: string;
  rawExcerpt: string;
  publishedAt: Date;
}

interface RssCustomItem {
  contentSnippet?: string;
  "content:encodedSnippet"?: string;
  "content:encoded"?: string;
  content?: string;
  summary?: string;
  description?: string;
}

const parser: Parser<unknown, RssCustomItem> = new Parser({
  timeout: 15_000,
  headers: {
    "User-Agent": "KerneliaBot/0.1 (+https://kernelia.app)",
  },
  customFields: {
    item: ["content:encoded", "content:encodedSnippet", "summary", "description"],
  },
});

export async function fetchFeed(source: Pick<Source, "rssUrl">): Promise<ParsedItem[]> {
  const feed = await parser.parseURL(source.rssUrl);
  const out: ParsedItem[] = [];

  for (const item of feed.items) {
    if (!item.link || !item.title) continue;
    const url = canonicalizeUrl(item.link);
    const published =
      parseDate(item.isoDate) ?? parseDate(item.pubDate) ?? null;
    if (!published) continue;

    const excerptSource =
      item.contentSnippet ??
      item["content:encodedSnippet"] ??
      item.summary ??
      item.description ??
      item["content:encoded"] ??
      item.content ??
      "";

    out.push({
      url,
      urlHash: urlHash(url),
      title: item.title.trim(),
      rawExcerpt: plainTextExcerpt(excerptSource),
      publishedAt: published,
    });
  }

  return out;
}
