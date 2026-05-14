import Parser from "rss-parser";
import type { Source } from "@/db/schema";
import { canonicalizeUrl, extractFirstImage, parseDate, plainTextExcerpt } from "./normalize";
import { urlHash } from "./dedupe";

export interface ParsedItem {
  url: string;
  urlHash: string;
  title: string;
  rawExcerpt: string;
  imageUrl: string | null;
  publishedAt: Date;
}

interface MediaNode {
  $?: { url?: string; medium?: string; type?: string };
  url?: string;
}

interface RssCustomItem {
  contentSnippet?: string;
  "content:encodedSnippet"?: string;
  "content:encoded"?: string;
  content?: string;
  summary?: string;
  description?: string;
  enclosure?: { url?: string; type?: string };
  "media:content"?: MediaNode | MediaNode[];
  "media:thumbnail"?: MediaNode | MediaNode[];
  itunes?: { image?: string };
  image?: string | { url?: string };
}

const parser: Parser<unknown, RssCustomItem> = new Parser({
  timeout: 15_000,
  headers: {
    "User-Agent": "KerneliaBot/0.1 (+https://kernelia.app)",
  },
  customFields: {
    item: [
      "content:encoded",
      "content:encodedSnippet",
      "summary",
      "description",
      ["media:content", "media:content", { keepArray: true }],
      ["media:thumbnail", "media:thumbnail", { keepArray: true }],
    ],
  },
});

function firstMediaUrl(node: MediaNode | MediaNode[] | undefined): string | null {
  if (!node) return null;
  const arr = Array.isArray(node) ? node : [node];
  for (const m of arr) {
    const candidate = m?.$?.url ?? m?.url;
    if (candidate && /^https?:\/\//i.test(candidate)) return candidate;
  }
  return null;
}

function extractImage(item: RssCustomItem): string | null {
  if (item.enclosure?.url && (item.enclosure.type ?? "").startsWith("image")) {
    return item.enclosure.url;
  }
  const media =
    firstMediaUrl(item["media:content"]) ?? firstMediaUrl(item["media:thumbnail"]);
  if (media) return media;
  if (typeof item.image === "string" && /^https?:\/\//i.test(item.image)) return item.image;
  if (typeof item.image === "object" && item.image?.url && /^https?:\/\//i.test(item.image.url)) {
    return item.image.url;
  }
  if (item.itunes?.image && /^https?:\/\//i.test(item.itunes.image)) return item.itunes.image;
  const fromHtml =
    extractFirstImage(item["content:encoded"]) ??
    extractFirstImage(item.content) ??
    extractFirstImage(item.description) ??
    extractFirstImage(item.summary);
  return fromHtml;
}

export async function fetchFeed(source: Pick<Source, "rssUrl">): Promise<ParsedItem[]> {
  const feed = await parser.parseURL(source.rssUrl);
  const out: ParsedItem[] = [];

  for (const item of feed.items) {
    if (!item.link || !item.title) continue;
    const url = canonicalizeUrl(item.link);
    const published = parseDate(item.isoDate) ?? parseDate(item.pubDate) ?? null;
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
      imageUrl: extractImage(item),
      publishedAt: published,
    });
  }

  return out;
}
