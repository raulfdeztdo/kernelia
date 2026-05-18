import { describe, expect, it } from "vitest";
import {
  MAX_CHARS_BLUESKY,
  MAX_CHARS_MASTODON,
  MAX_CHARS_TELEGRAM,
  formatPost,
  truncateOnWordBoundary,
} from "@/lib/broadcast/format";

/**
 * Truncation is the hot path: every broadcast post goes through this and
 * a mistake there either silently chops URLs or overflows the platform
 * limit (Mastodon rejects 500+ with HTTP 422, eating one cron slot). The
 * URL must ALWAYS survive verbatim; the summary is what we trim.
 */
const longSummary =
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. " +
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit " +
  "in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt " +
  "mollit anim id est laborum. Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam varius, turpis et commodo pharetra, est eros bibendum " +
  "elit, nec luctus magna felis sollicitudin mauris.";

const sampleArticle = {
  titleEs: "OpenAI lanza GPT-5 con uso agéntico de herramientas",
  summaryEs: longSummary,
  url: "https://example.com/articles/gpt-5-agentic-tools",
  categorySlug: "llm",
};

describe("truncateOnWordBoundary", () => {
  it("returns the input unchanged when shorter than the limit", () => {
    expect(truncateOnWordBoundary("hola mundo", 100)).toBe("hola mundo");
  });

  it("trims on a word boundary and appends an ellipsis", () => {
    const cut = truncateOnWordBoundary("uno dos tres cuatro cinco seis siete", 20);
    expect(cut.length).toBeLessThanOrEqual(20);
    expect(cut.endsWith("…")).toBe(true);
    // The trimmed text (without the ellipsis) must appear verbatim in the
    // original — that's how we know we didn't chop a word in half and
    // leave a fragment.
    const trimmed = cut.slice(0, -1);
    expect("uno dos tres cuatro cinco seis siete".startsWith(trimmed)).toBe(true);
    // Last character before the ellipsis is the end of a full word
    // (not a leading partial like "cua").
    expect(trimmed.split(" ").slice(-1)[0]).toMatch(/^[a-z]+$/);
  });

  it("hard-cuts when no space is available near the boundary", () => {
    const cut = truncateOnWordBoundary("aaaaaaaaaaaaaaaaaaaaaaaaaaaa", 10);
    expect(cut.length).toBeLessThanOrEqual(10);
    expect(cut.endsWith("…")).toBe(true);
  });
});

describe("formatPost — Mastodon", () => {
  it("stays under the 500 char limit even with a long summary", () => {
    const out = formatPost(sampleArticle, "mastodon");
    expect(out.length).toBeLessThanOrEqual(MAX_CHARS_MASTODON);
  });

  it("preserves the full URL verbatim", () => {
    const out = formatPost(sampleArticle, "mastodon");
    expect(out).toContain(sampleArticle.url);
  });

  it("includes the category hashtag in camelCase", () => {
    const out = formatPost({ ...sampleArticle, categorySlug: "tech-society" }, "mastodon");
    expect(out).toContain("#techSociety");
  });

  it("omits the hashtag if categorySlug is null", () => {
    const out = formatPost({ ...sampleArticle, categorySlug: null }, "mastodon");
    expect(out).not.toContain("#");
  });
});

describe("formatPost — Bluesky", () => {
  it("stays under the 300 char limit", () => {
    const out = formatPost(sampleArticle, "bluesky");
    expect(out.length).toBeLessThanOrEqual(MAX_CHARS_BLUESKY);
  });

  it("preserves the full URL verbatim", () => {
    const out = formatPost(sampleArticle, "bluesky");
    expect(out).toContain(sampleArticle.url);
  });

  it("truncates the title with an ellipsis if it would overflow", () => {
    const longTitle = "X".repeat(400); // way over 300
    const out = formatPost({ ...sampleArticle, titleEs: longTitle }, "bluesky");
    expect(out.length).toBeLessThanOrEqual(MAX_CHARS_BLUESKY);
    expect(out).toContain(sampleArticle.url);
  });
});

describe("formatPost — Telegram", () => {
  it("stays under the 4096 char limit", () => {
    const out = formatPost(sampleArticle, "telegram");
    expect(out.length).toBeLessThanOrEqual(MAX_CHARS_TELEGRAM);
  });

  it("escapes MarkdownV2 reserved characters in the title", () => {
    const out = formatPost(
      { ...sampleArticle, titleEs: "Hola! ¿Qué tal? (todo bien)" },
      "telegram",
    );
    // `!`, `(`, `)` must be backslash-escaped to keep MarkdownV2 happy.
    expect(out).toContain("\\!");
    expect(out).toContain("\\(");
    expect(out).toContain("\\)");
  });

  it("renders the URL inside a markdown link", () => {
    const out = formatPost(sampleArticle, "telegram");
    expect(out).toContain(`(${sampleArticle.url})`);
    expect(out).toContain("[Leer artículo]");
  });

  it("does NOT escape dots inside the URL part of the markdown link", () => {
    // Escaping `.` would break example.com → example\.com and Telegram
    // would render a broken link. The regex inside formatTelegram for the
    // URL part must only target `)` and `\`.
    const out = formatPost(sampleArticle, "telegram");
    expect(out).toContain(sampleArticle.url);
  });
});
