import { describe, expect, it } from "vitest";
import { subscribePreferredCategoriesSchema } from "@/lib/newsletter/subscribe-flow";
import { digestCacheKey } from "@/lib/newsletter/digest";

/**
 * Phase 8.H micro-units. These guard the two pure primitives that the
 * subscribe + run paths lean on:
 *
 *  - `subscribePreferredCategoriesSchema` is the only place where
 *    untrusted user input becomes a category-slug array. If it lets
 *    junk through, that junk reaches Postgres as a `text[]` row.
 *  - `digestCacheKey` is used by `runNewsletter` to dedupe digest
 *    fetches across subscribers; if it isn't stable across slug
 *    order, the cache misses on every subscriber and we burn
 *    quadratic queries on the cron.
 */

describe("subscribePreferredCategoriesSchema", () => {
  it("accepts a list of valid slugs and returns it unchanged", () => {
    const r = subscribePreferredCategoriesSchema.safeParse(["llm", "agents"]);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(["llm", "agents"]);
  });

  it("lowercases and trims each slug, dedupes the result", () => {
    const r = subscribePreferredCategoriesSchema.safeParse(["  LLM ", "llm", "Agents"]);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual(["llm", "agents"]);
  });

  it("rejects items that aren't slug-shaped (spaces, punctuation, accents)", () => {
    expect(subscribePreferredCategoriesSchema.safeParse(["llm models"]).success).toBe(false);
    expect(subscribePreferredCategoriesSchema.safeParse(["robótica"]).success).toBe(false);
    expect(subscribePreferredCategoriesSchema.safeParse(["llm!"]).success).toBe(false);
  });

  it("rejects payloads that aren't arrays", () => {
    expect(subscribePreferredCategoriesSchema.safeParse("llm").success).toBe(false);
    expect(subscribePreferredCategoriesSchema.safeParse({ a: 1 }).success).toBe(false);
    expect(subscribePreferredCategoriesSchema.safeParse(null).success).toBe(false);
  });

  it("caps the list at 32 entries (DoS guard)", () => {
    const ok = Array.from({ length: 32 }, (_, i) => `cat${i}`);
    const tooMany = [...ok, "cat32"];
    expect(subscribePreferredCategoriesSchema.safeParse(ok).success).toBe(true);
    expect(subscribePreferredCategoriesSchema.safeParse(tooMany).success).toBe(false);
  });

  it("accepts an empty array (the 'all categories' default)", () => {
    const r = subscribePreferredCategoriesSchema.safeParse([]);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toEqual([]);
  });
});

describe("digestCacheKey", () => {
  it("returns a stable string regardless of slug order", () => {
    expect(digestCacheKey("es", ["llm", "agents"])).toBe(
      digestCacheKey("es", ["agents", "llm"]),
    );
  });

  it("namespaces by locale (es and en don't collide)", () => {
    expect(digestCacheKey("es", ["llm"])).not.toBe(digestCacheKey("en", ["llm"]));
  });

  it("uses a sentinel for the empty selection so it can't collide with explicit picks", () => {
    // If we just joined the empty array, the key would be "es|" which
    // is technically distinct from any non-empty key but visually
    // ambiguous when grepping logs. The sentinel makes "all" obvious.
    expect(digestCacheKey("es", [])).toBe("es|<all>");
    expect(digestCacheKey("es", [])).not.toBe(digestCacheKey("es", ["llm"]));
  });
});
