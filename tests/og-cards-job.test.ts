import { describe, expect, it, vi } from "vitest";
import type { OgCardArticle } from "@/db/queries/articles";
import {
  OG_CARD_KEEP_DAYS,
  OG_CARDS_MAX_RENDERS,
  planOgCards,
  runOgCardsJob,
} from "@/lib/og/cards-job";
import { StorageClient, resolveOgCardUrl } from "@/lib/og/storage";

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
      listArticles: async () => [
        article("eeeeeeee", 1),
        { ...article("ffffffff", 1), titleEs: null },
      ],
      listExisting: async () => [
        "es/eeeeeeee0000.png",
        "en/ffffffff0000.png",
        "es/old00000000.png",
      ],
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
    await expect(resolveOgCardUrl("es", ID, missing)).resolves.toMatch(
      /\/api\/og\/es\/9fa234db12e2$/,
    );
    const down = vi.fn(async () => {
      throw new Error("network");
    });
    await expect(resolveOgCardUrl("es", ID, down)).resolves.toMatch(/\/api\/og\/es\/9fa234db12e2$/);
    vi.unstubAllEnvs();
  });
});

describe("StorageClient", () => {
  function fakeFetch(responses: Response[]) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return responses.shift() ?? new Response("[]");
    };
    return { impl, calls };
  }

  it("uploads with upsert, content type and a week of cache", async () => {
    const { impl, calls } = fakeFetch([new Response("{}")]);
    const client = new StorageClient({
      supabaseUrl: "https://ref.supabase.co/",
      serviceKey: "k",
      fetchImpl: impl,
    });
    await client.upload("es/abc.png", new Uint8Array([1]));
    expect(calls[0]?.url).toBe("https://ref.supabase.co/storage/v1/object/og-cards/es/abc.png");
    expect(calls[0]?.init.headers).toMatchObject({
      Authorization: "Bearer k",
      "Content-Type": "image/png",
      "Cache-Control": "max-age=604800",
      "x-upsert": "true",
    });
  });

  it("pages through list until a short page", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ name: `${i}.png` }));
    const { impl, calls } = fakeFetch([
      new Response(JSON.stringify(full)),
      new Response(JSON.stringify([{ name: "last.png" }])),
    ]);
    const client = new StorageClient({
      supabaseUrl: "https://ref.supabase.co",
      serviceKey: "k",
      fetchImpl: impl,
    });
    const names = await client.list("es/");
    expect(names).toHaveLength(1001);
    expect(calls.map((c) => JSON.parse(String(c.init.body)).offset)).toEqual([0, 1000]);
  });

  it("removes in batches of 1000 and does nothing for an empty list", async () => {
    const { impl, calls } = fakeFetch([]);
    const client = new StorageClient({
      supabaseUrl: "https://ref.supabase.co",
      serviceKey: "k",
      fetchImpl: impl,
    });
    await client.remove([]);
    expect(calls).toHaveLength(0);
    await client.remove(Array.from({ length: 1500 }, (_, i) => `es/${i}.png`));
    expect(calls.map((c) => JSON.parse(String(c.init.body)).prefixes.length)).toEqual([1000, 500]);
  });

  it("throws with the status, never the key, on an error response", async () => {
    const { impl } = fakeFetch([new Response("bad", { status: 403 })]);
    const client = new StorageClient({
      supabaseUrl: "https://ref.supabase.co",
      serviceKey: "secret",
      fetchImpl: impl,
    });
    const err = await client.upload("es/a.png", new Uint8Array()).catch((e: Error) => e);
    expect(String(err)).toContain("HTTP 403");
    expect(String(err)).not.toContain("secret");
  });
});
