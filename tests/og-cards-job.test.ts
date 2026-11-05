import { describe, expect, it, vi } from "vitest";
import type { OgCardArticle } from "@/db/queries/articles";
import {
  OG_CARD_KEEP_DAYS,
  OG_CARDS_MAX_RENDERS,
  planOgCards,
  runOgCardsJob,
} from "@/lib/og/cards-job";
import { resolveOgCardUrl } from "@/lib/og/storage";

const NOW = new Date("2026-11-05T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

function article(id: string, ageDays: number): OgCardArticle {
  return {
    id: `${id}-0000-4000-8000-000000000000`,
    titleEs: `Título ${id}`,
    titleEn: null,
    originalTitle: `Title ${id}`,
    sourceName: "Xataka",
    categorySlug: "llm",
    publishedAt: daysAgo(ageDays),
  };
}

describe("planOgCards", () => {
  it("renders the missing cards of fresh articles, in both locales", () => {
    const plan = planOgCards([article("aaaaaaaa", 1)], new Set(["es/aaaaaaaa0000.png"]), NOW);
    expect(plan.render.map((r) => r.path)).toEqual(["en/aaaaaaaa0000.png"]);
    expect(plan.remove).toEqual([]);
  });

  it("keeps but doesn't render cards of articles past the fresh window", () => {
    // 10 days old: pages no longer advertise it, but one cached on day 7
    // may still point at it until day 14.
    const plan = planOgCards([article("bbbbbbbb", 10)], new Set(["es/bbbbbbbb0000.png"]), NOW);
    expect(plan.render).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("removes cards older than the keep window and of articles no longer public", () => {
    const plan = planOgCards(
      [article("cccccccc", OG_CARD_KEEP_DAYS + 1)],
      new Set(["es/cccccccc0000.png", "en/dddddddd0000.png"]),
      NOW,
    );
    expect(plan.remove.sort()).toEqual(["en/dddddddd0000.png", "es/cccccccc0000.png"]);
  });

  it("caps the renders per run", () => {
    const many = Array.from({ length: OG_CARDS_MAX_RENDERS }, (_, i) =>
      article(i.toString(16).padStart(8, "0"), 1),
    );
    expect(planOgCards(many, new Set(), NOW).render).toHaveLength(OG_CARDS_MAX_RENDERS);
  });
});

describe("runOgCardsJob", () => {
  it("renders with the locale's title and labels, uploads, and counts failures", async () => {
    const renderCard = vi.fn(async (input: { title: string }) => {
      if (input.title === "Title ffffffff") throw new Error("boom");
      return new Uint8Array([1]);
    });
    const upload = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const summary = await runOgCardsJob({
      listArticles: async () => [article("eeeeeeee", 1), { ...article("ffffffff", 1), titleEs: null }],
      listExisting: async () => ["es/eeeeeeee0000.png", "en/ffffffff0000.png", "es/old00000000.png"],
      renderCard,
      upload,
      remove,
      labels: (locale) => ({
        category: (slug) => `${locale}:${slug}`,
        via: (source) => `${locale} via ${source}`,
      }),
      now: NOW,
    });
    expect(renderCard).toHaveBeenCalledWith({
      title: "Title eeeeeeee",
      categorySlug: "llm",
      categoryLabel: "en:llm",
      via: "en via Xataka",
    });
    expect(upload).toHaveBeenCalledWith("en/eeeeeeee0000.png", new Uint8Array([1]));
    expect(summary).toMatchObject({ articles: 2, rendered: 1, failed: 1, removed: 1 });
    expect(remove).toHaveBeenCalledWith(["es/old00000000.png"]);
  });
});

describe("resolveOgCardUrl", () => {
  const ID = "9fa234db-12e2-4c3d-8e9f-0a1b2c3d4e5f";

  it("uses the Storage copy when it exists", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(resolveOgCardUrl("es", ID, fetchImpl)).resolves.toBe(
      "https://ref.supabase.co/storage/v1/object/public/og-cards/es/9fa234db12e2.png",
    );
    vi.unstubAllEnvs();
  });

  it("falls back to the /api/og route when the copy is missing or unreachable", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ref.supabase.co");
    const missing = vi.fn(async () => new Response(null, { status: 400 }));
    await expect(resolveOgCardUrl("es", ID, missing)).resolves.toMatch(/\/api\/og\/es\/9fa234db12e2$/);
    const down = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(resolveOgCardUrl("es", ID, down)).resolves.toMatch(/\/api\/og\/es\/9fa234db12e2$/);
    vi.unstubAllEnvs();
  });
});
