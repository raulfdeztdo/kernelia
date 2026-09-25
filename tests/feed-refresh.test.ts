import { describe, expect, it } from "vitest";
import type { ArticleCardView } from "@/components/news-card";
import { mergeFreshArticles } from "@/lib/feed-refresh";

function card(id: string, publishedAt: string): ArticleCardView {
  return {
    id,
    title: id,
    url: `https://src.example/${id}`,
    href: `/n/${id}`,
    shareUrl: `https://kernelia.dev/n/${id}`,
    summary: null,
    imageUrl: null,
    publishedAt,
    sourceName: "Src",
    categorySlug: "llm",
  };
}

const onScreen = [
  card("c", "2026-09-25T10:00:00.000Z"),
  card("b", "2026-09-25T08:00:00.000Z"),
  card("a", "2026-09-25T06:00:00.000Z"),
];

describe("mergeFreshArticles", () => {
  it("inserts newer articles in chronological order", () => {
    const { items, added } = mergeFreshArticles(onScreen, [
      card("d", "2026-09-25T11:00:00.000Z"),
      card("c", "2026-09-25T10:00:00.000Z"),
    ]);
    expect(added.map((a) => a.id)).toEqual(["d"]);
    expect(items.map((a) => a.id)).toEqual(["d", "c", "b", "a"]);
  });

  it("slots a late-classified article inside the loaded range", () => {
    const { items } = mergeFreshArticles(onScreen, [card("x", "2026-09-25T09:00:00.000Z")]);
    expect(items.map((a) => a.id)).toEqual(["c", "x", "b", "a"]);
  });

  it("leaves articles older than the loaded range to 'load more'", () => {
    const { items, added } = mergeFreshArticles(onScreen, [
      card("old", "2026-09-24T00:00:00.000Z"),
    ]);
    expect(added).toEqual([]);
    expect(items.map((a) => a.id)).toEqual(["c", "b", "a"]);
  });

  it("is a no-op when nothing is new", () => {
    const { items, added } = mergeFreshArticles(onScreen, onScreen);
    expect(added).toEqual([]);
    expect(items).toEqual(onScreen);
  });
});
