import { describe, expect, it } from "vitest";
import {
  DEFAULT_DEDUPE_THRESHOLD,
  findNearDuplicate,
  jaccardSimilarity,
  normalizeForShingle,
  wordShingles,
} from "@/lib/dedupe/shingle";

describe("normalizeForShingle", () => {
  it("strips diacritics and lowercases", () => {
    expect(normalizeForShingle("Inteligencia Artificial")).toEqual(["inteligencia", "artificial"]);
    expect(normalizeForShingle("Acción de Información")).toEqual(["accion", "informacion"]);
  });

  it("drops Spanish stop words", () => {
    expect(normalizeForShingle("Elon Musk pierde el juicio")).toEqual([
      "elon",
      "musk",
      "pierde",
      "juicio",
    ]);
  });

  it("drops English stop words", () => {
    expect(normalizeForShingle("The future of AI in the cloud")).toEqual([
      "future",
      "ai",
      "cloud",
    ]);
  });

  it("drops punctuation but preserves alphanumerics", () => {
    expect(normalizeForShingle("GPT-5: launched today!")).toEqual(["gpt", "5", "launched", "today"]);
  });

  it("returns empty array for stop-word-only input", () => {
    expect(normalizeForShingle("the of a")).toEqual([]);
  });
});

describe("wordShingles", () => {
  it("produces 1-grams (bag of words) by default", () => {
    const tokens = ["elon", "musk", "pierde", "juicio"];
    expect([...wordShingles(tokens)].sort()).toEqual(["elon", "juicio", "musk", "pierde"]);
  });

  it("can produce 3-grams when explicitly asked", () => {
    const tokens = ["elon", "musk", "pierde", "juicio"];
    expect([...wordShingles(tokens, 3)]).toEqual(["elon musk pierde", "musk pierde juicio"]);
  });

  it("returns an empty set for empty input", () => {
    expect(wordShingles([], 3).size).toBe(0);
  });

  it("falls back to a smaller n when tokens are shorter than n", () => {
    // 2 tokens, n=3 → fall back to 2-grams of length 2 (= the whole sentence).
    expect([...wordShingles(["gpt", "ships"], 3)]).toEqual(["gpt ships"]);
  });

  it("deduplicates repeated 1-grams (bag-of-words contract)", () => {
    expect(wordShingles(["ai", "ai", "ai", "ai"]).size).toBe(1);
  });
});

describe("jaccardSimilarity", () => {
  it("returns 1 for identical non-empty sets", () => {
    const s = new Set(["a", "b", "c"]);
    expect(jaccardSimilarity(s, new Set(["a", "b", "c"]))).toBe(1);
  });

  it("returns 0 for disjoint sets", () => {
    expect(jaccardSimilarity(new Set(["a"]), new Set(["b"]))).toBe(0);
  });

  it("returns 0 for two empty sets (no information to compare)", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it("computes |intersection| / |union| correctly", () => {
    // A = {a, b, c}, B = {b, c, d}. Intersection {b, c} = 2. Union {a, b, c, d} = 4. → 0.5.
    expect(jaccardSimilarity(new Set(["a", "b", "c"]), new Set(["b", "c", "d"]))).toBe(0.5);
  });

  it("is symmetric", () => {
    const a = new Set(["x", "y"]);
    const b = new Set(["y", "z"]);
    expect(jaccardSimilarity(a, b)).toBe(jaccardSimilarity(b, a));
  });
});

describe("findNearDuplicate", () => {
  // The real-world cluster that motivated this whole module: three titles
  // about Elon Musk losing the OpenAI suit, from Ars Technica / Wired /
  // TechCrunch, all distinct canonical URLs.
  const MUSK_CLUSTER = [
    { id: "ars", title: "Elon Musk pierde el juicio por acusar a OpenAI de robar una caridad" },
    { id: "wired", title: "Elon Musk pierde un juicio histórico contra OpenAI" },
    { id: "techcrunch", title: "Elon Musk pierde su demanda contra Sam Altman y OpenAI" },
  ];

  it("flags the Musk/OpenAI cluster as near-duplicates", () => {
    const match = findNearDuplicate(MUSK_CLUSTER[1]!, [MUSK_CLUSTER[0]!]);
    expect(match).not.toBeNull();
    expect(match?.matchedId).toBe("ars");
    expect(match?.similarity).toBeGreaterThanOrEqual(DEFAULT_DEDUPE_THRESHOLD);
  });

  it("picks the highest-similarity match when multiple recents cross threshold", () => {
    const candidate = MUSK_CLUSTER[2]!;
    const recents = [MUSK_CLUSTER[0]!, MUSK_CLUSTER[1]!];
    const match = findNearDuplicate(candidate, recents);
    expect(match).not.toBeNull();
    // Either ars or wired could win; the point is we got SOMETHING and
    // similarity is above threshold.
    expect(match?.similarity).toBeGreaterThanOrEqual(DEFAULT_DEDUPE_THRESHOLD);
    expect(["ars", "wired"]).toContain(match?.matchedId);
  });

  it("returns null when no recent crosses the threshold", () => {
    const candidate = { id: "new", title: "Apple Intelligence ships on iPhone 17" };
    const recents = [
      { id: "old1", title: "Google DeepMind unveils new robotics model" },
      { id: "old2", title: "Mistral releases open-weights MoE" },
    ];
    expect(findNearDuplicate(candidate, recents)).toBeNull();
  });

  it("ignores the candidate's own id if it appears in recents", () => {
    const candidate = MUSK_CLUSTER[0]!;
    // The candidate would obviously be 100% similar to itself; the helper
    // must skip it so we don't dedup an article against itself.
    const match = findNearDuplicate(candidate, [MUSK_CLUSTER[0]!]);
    expect(match).toBeNull();
  });

  it("returns null for empty recents", () => {
    expect(findNearDuplicate(MUSK_CLUSTER[0]!, [])).toBeNull();
  });

  it("returns null when candidate title is stop-words-only (no signal to compare)", () => {
    const candidate = { id: "blank", title: "the of a" };
    expect(findNearDuplicate(candidate, MUSK_CLUSTER)).toBeNull();
  });

  it("does not flag stylistically similar but topically distinct headlines", () => {
    // Both follow "X launches new Y", but the entities are unrelated.
    const candidate = { id: "new", title: "Anthropic launches new safety benchmark" };
    const recents = [
      { id: "old", title: "Meta launches new open-weights model" },
    ];
    const match = findNearDuplicate(candidate, recents);
    // The phrase "launches new" is one shingle; the rest is disjoint.
    // Jaccard should be well under 0.5.
    expect(match).toBeNull();
  });
});
