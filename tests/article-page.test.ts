import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ARTICLE_PAGE_TTL_S, articleCacheTag } from "@/lib/article-page";

describe("article page cache", () => {
  it("tags by short id, from the full id or the short id alike", () => {
    expect(articleCacheTag("9fa234db-12e2-4c3d-8e9f-0a1b2c3d4e5f")).toBe("article:9fa234db12e2");
    expect(articleCacheTag("9fa234db12e2")).toBe("article:9fa234db12e2");
  });

  it("keeps the page's literal `revalidate` equal to ARTICLE_PAGE_TTL_S", () => {
    // Next needs a literal in the segment config, so the two can drift
    // apart; a shorter data TTL would silently shrink the page's.
    const source = readFileSync(join(process.cwd(), "app/[locale]/n/[slug]/page.tsx"), "utf8");
    const match = /export const revalidate = ([\d_]+);/.exec(source);
    expect(Number(match?.[1]?.replace(/_/g, ""))).toBe(ARTICLE_PAGE_TTL_S);
  });
});
