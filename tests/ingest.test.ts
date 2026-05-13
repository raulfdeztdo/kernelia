import { describe, expect, it } from "vitest";
import { canonicalizeUrl, parseDate, plainTextExcerpt } from "@/lib/ingest/normalize";
import { urlHash } from "@/lib/ingest/dedupe";

describe("canonicalizeUrl", () => {
  it("lowercases host and removes fragment", () => {
    expect(canonicalizeUrl("https://Example.COM/path#section")).toBe("https://example.com/path");
  });

  it("strips utm_* and other tracking params", () => {
    const input = "https://example.com/a?utm_source=x&utm_campaign=y&keep=1&fbclid=abc";
    expect(canonicalizeUrl(input)).toBe("https://example.com/a?keep=1");
  });

  it("sorts remaining query params for stable order", () => {
    expect(canonicalizeUrl("https://example.com/?b=2&a=1")).toBe(
      "https://example.com/?a=1&b=2",
    );
  });

  it("removes trailing slash except on root", () => {
    expect(canonicalizeUrl("https://example.com/path/")).toBe("https://example.com/path");
    expect(canonicalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("returns trimmed input when URL is unparseable", () => {
    expect(canonicalizeUrl("  not a url  ")).toBe("not a url");
  });
});

describe("urlHash", () => {
  it("is deterministic for the same canonical URL", () => {
    const a = urlHash("https://example.com/post?utm_source=x");
    const b = urlHash("https://example.com/post");
    expect(a).toBe(b);
  });

  it("differs across distinct canonical URLs", () => {
    expect(urlHash("https://example.com/a")).not.toBe(urlHash("https://example.com/b"));
  });

  it("is a 64-char hex string (sha256)", () => {
    expect(urlHash("https://example.com")).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("plainTextExcerpt", () => {
  it("strips tags, decodes basic entities, collapses whitespace", () => {
    const html = "<p>Hello&nbsp;<strong>world</strong>&amp;more</p>\n\n<p>line two</p>";
    expect(plainTextExcerpt(html)).toBe("Hello world &more line two");
  });

  it("drops script and style content", () => {
    const html = "<style>.x{}</style>OK<script>evil()</script>end";
    expect(plainTextExcerpt(html)).toBe("OKend");
  });

  it("truncates to max length with ellipsis", () => {
    const result = plainTextExcerpt("a".repeat(20), 10);
    expect(result).toHaveLength(10);
    expect(result.endsWith("…")).toBe(true);
  });

  it("returns empty string for null/undefined", () => {
    expect(plainTextExcerpt(null)).toBe("");
    expect(plainTextExcerpt(undefined)).toBe("");
  });
});

describe("parseDate", () => {
  it("parses ISO 8601", () => {
    const d = parseDate("2026-05-13T10:00:00Z");
    expect(d?.toISOString()).toBe("2026-05-13T10:00:00.000Z");
  });

  it("returns null for invalid input", () => {
    expect(parseDate("not a date")).toBeNull();
    expect(parseDate(undefined)).toBeNull();
    expect(parseDate("")).toBeNull();
  });
});
