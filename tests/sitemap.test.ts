import { describe, expect, it } from "vitest";
import { SITEMAP_WINDOW_DAYS, articleEntries, sitemapSince } from "@/lib/sitemap";

describe("articleEntries", () => {
  it("emits one entry per locale with per-locale slugs and hreflang", () => {
    const entries = articleEntries([
      {
        id: "9fa234db-12e2-4c3d-8e9f-0a1b2c3d4e5f",
        titleEs: "Hola mundo",
        titleEn: null,
        originalTitle: "Hello world",
        publishedAt: new Date("2026-09-25T10:00:00Z"),
      },
    ]);
    expect(entries).toHaveLength(2);
    const [es, en] = entries;
    expect(es?.url).toMatch(/\/n\/hola-mundo-9fa234db12e2$/);
    // No English translation yet → the original title drives the EN slug.
    expect(en?.url).toMatch(/\/en\/n\/hello-world-9fa234db12e2$/);
    expect(es?.alternates?.languages).toEqual(en?.alternates?.languages);
    expect(es?.alternates?.languages?.["x-default"]).toBe(es?.url);
  });
});

describe("sitemapSince", () => {
  it("only advertises the last SITEMAP_WINDOW_DAYS days", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    expect(SITEMAP_WINDOW_DAYS).toBe(90);
    expect(sitemapSince(now).toISOString()).toBe("2026-07-30T12:00:00.000Z");
  });
});
