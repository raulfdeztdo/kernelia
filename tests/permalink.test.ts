import { describe, expect, it } from "vitest";
import {
  OG_CARD_MAX_AGE_DAYS,
  articleHref,
  articleShareImageUrl,
  articlePath,
  articleSegment,
  defaultOgImageUrl,
  hasOwnOgCard,
  parseArticleSegment,
  shortIdOf,
  shortIdRange,
  slugify,
  withUtm,
} from "@/lib/permalink";

const ID = "9fa234db-12e2-4c3d-8e9f-0a1b2c3d4e5f";

describe("slugify", () => {
  it("strips accents, punctuation and case", () => {
    expect(slugify('Microsoft cree que su nuevo "super app" será tan influyente')).toBe(
      "microsoft-cree-que-su-nuevo-super-app-sera-tan-influyente",
    );
    expect(slugify("¿Pueden las IA ganar a España? Sí, según…")).toBe(
      "pueden-las-ia-ganar-a-espana-si-segun",
    );
  });

  it("caps long titles on a word boundary", () => {
    const slug = slugify("palabra ".repeat(30));
    expect(slug.length).toBeLessThanOrEqual(70);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug.endsWith("palabra")).toBe(true);
  });

  it("never returns an empty slug", () => {
    expect(slugify("¿¡!?")).toBe("n");
  });
});

describe("paths", () => {
  it("builds the segment from slug + 12-hex short id", () => {
    expect(shortIdOf(ID)).toBe("9fa234db12e2");
    expect(articleSegment(ID, "Hola mundo")).toBe("hola-mundo-9fa234db12e2");
    expect(articlePath(ID, "Hola mundo")).toBe("/n/hola-mundo-9fa234db12e2");
  });

  it("prefixes only the non-default locale", () => {
    expect(articleHref("es", ID, "Hola")).toBe("/n/hola-9fa234db12e2");
    expect(articleHref("en", ID, "Hello")).toBe("/en/n/hello-9fa234db12e2");
  });
});

describe("parseArticleSegment", () => {
  it("splits slug and short id", () => {
    expect(parseArticleSegment("hola-mundo-9fa234db12e2")).toEqual({
      slug: "hola-mundo",
      shortId: "9fa234db12e2",
    });
  });

  it("accepts a bare short id and normalises case", () => {
    expect(parseArticleSegment("9FA234DB12E2")).toEqual({ slug: "", shortId: "9fa234db12e2" });
  });

  it("rejects segments without a valid short id", () => {
    expect(parseArticleSegment("hola-mundo")).toBeNull();
    expect(parseArticleSegment("hola-9fa234db12")).toBeNull();
    expect(parseArticleSegment("hola-9fa234db12zz")).toBeNull();
  });
});

describe("shortIdRange", () => {
  it("brackets every UUID that starts with the short id", () => {
    const { lo, hi } = shortIdRange("9fa234db12e2");
    expect(lo).toBe("9fa234db-12e2-0000-0000-000000000000");
    expect(hi).toBe("9fa234db-12e2-ffff-ffff-ffffffffffff");
    expect(ID >= lo && ID <= hi).toBe(true);
  });
});

describe("withUtm", () => {
  it("appends the UTM parameters", () => {
    const url = new URL(
      withUtm("https://kernelia.dev/n/x-9fa234db12e2", { source: "bluesky", medium: "social" }),
    );
    expect(url.searchParams.get("utm_source")).toBe("bluesky");
    expect(url.searchParams.get("utm_medium")).toBe("social");
    expect(url.searchParams.has("utm_campaign")).toBe(false);
  });
});

describe("social image", () => {
  const NOW = new Date("2026-10-28T12:00:00Z");
  const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

  it("keeps the rendered card only while the article is fresh", () => {
    expect(hasOwnOgCard(daysAgo(0), NOW)).toBe(true);
    expect(hasOwnOgCard(daysAgo(OG_CARD_MAX_AGE_DAYS), NOW)).toBe(true);
    expect(hasOwnOgCard(daysAgo(OG_CARD_MAX_AGE_DAYS + 0.01), NOW)).toBe(false);
  });

  it("points fresh articles at their card and older ones at the static one", () => {
    expect(articleShareImageUrl("en", { id: ID, publishedAt: daysAgo(1) }, NOW)).toMatch(
      /\/api\/og\/en\/9fa234db12e2$/,
    );
    expect(articleShareImageUrl("es", { id: ID, publishedAt: daysAgo(30) }, NOW)).toBe(
      defaultOgImageUrl("es"),
    );
    expect(defaultOgImageUrl("en")).toMatch(/\/og\/default-en\.png$/);
  });
});
