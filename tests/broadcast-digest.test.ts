import { describe, expect, it } from "vitest";
import type { DigestCandidate } from "@/db/queries/article-broadcasts";
import {
  digestBlurb,
  formatDigestMessage,
  getDueSlot,
  pickDigestArticles,
  runDigest,
  type RunDigestOptions,
} from "@/lib/broadcast/digest";
import { digestStatus } from "@/lib/cron-logging";

/**
 * Phase 9.C contract: two Telegram digests a day, never twice per slot,
 * never lost to a transient failure, never repeating an article.
 */

function cand(id: string, sourceName: string, relevanceScore = 0.9): DigestCandidate {
  return {
    id: `${id.padEnd(8, "0")}-0000-4000-8000-000000000000`,
    titleEs: `Titular ${id}`,
    summaryEs: `Resumen de ${id}. Segunda frase que no debe salir.`,
    url: `https://src.example/${id}`,
    categorySlug: "llm",
    relevanceScore,
    sourceName,
  };
}

// 2026-09-25 is CEST (UTC+2): 06:30Z = 08:30 Madrid, 15:30Z = 17:30 Madrid.
const MORNING = new Date("2026-09-25T06:30:00Z");
const EARLY = new Date("2026-09-25T05:30:00Z");

describe("getDueSlot", () => {
  it("follows the Madrid wall clock across DST", () => {
    expect(getDueSlot(EARLY)).toBeNull(); // 07:30 CEST
    expect(getDueSlot(MORNING)).toBe("morning"); // 08:30 CEST
    expect(getDueSlot(new Date("2026-09-25T10:59:00Z"))).toBe("morning"); // 12:59 CEST
    expect(getDueSlot(new Date("2026-09-25T11:00:00Z"))).toBeNull(); // 13:00, window closed
    expect(getDueSlot(new Date("2026-09-25T15:00:00Z"))).toBe("afternoon"); // 17:00 CEST
    expect(getDueSlot(new Date("2026-09-25T19:59:00Z"))).toBe("afternoon"); // 21:59 CEST
    expect(getDueSlot(new Date("2026-09-25T20:00:00Z"))).toBeNull(); // 22:00, too late
    // Winter (CET, UTC+1): 07:00Z = 08:00 Madrid.
    expect(getDueSlot(new Date("2026-12-01T06:59:00Z"))).toBeNull();
    expect(getDueSlot(new Date("2026-12-01T07:00:00Z"))).toBe("morning");
  });
});

describe("pickDigestArticles", () => {
  it("keeps relevance order and caps each source at two", () => {
    const picked = pickDigestArticles([
      cand("a", "Verge"),
      cand("b", "Verge"),
      cand("c", "Verge"),
      cand("d", "Wired"),
      cand("e", "Xataka"),
      cand("f", "Wired"),
      cand("g", "TC"),
    ]);
    expect(picked.map((p) => p.titleEs)).toEqual([
      "Titular a",
      "Titular b",
      "Titular d",
      "Titular e",
      "Titular f",
    ]);
  });
});

describe("digestBlurb", () => {
  it("keeps the first sentence only", () => {
    expect(digestBlurb("Primera frase. Segunda frase.")).toBe("Primera frase.");
    expect(digestBlurb("Versión 2.5 del modelo llega hoy. Más info.")).toBe(
      "Versión 2.5 del modelo llega hoy.",
    );
    expect(digestBlurb(null)).toBeNull();
  });

  it("cuts a very long sentence on a word boundary", () => {
    const blurb = digestBlurb(`${"palabra ".repeat(40)}fin.`);
    expect(blurb?.length).toBeLessThanOrEqual(170);
    expect(blurb?.endsWith("…")).toBe(true);
  });
});

describe("formatDigestMessage", () => {
  it("builds an escaped MarkdownV2 digest", () => {
    const text = formatDigestMessage({
      slot: "morning",
      now: MORNING,
      items: [
        {
          title: "GPT-6 (beta) llega!",
          summary: "OpenAI lo anuncia. Más.",
          link: "https://kernelia.dev/n/x-1?utm_source=telegram",
        },
      ],
      homeLink: "https://kernelia.dev/?utm_source=telegram",
    });
    expect(text).toContain("☀️ *La IA de esta mañana*");
    expect(text).toContain("_viernes 25 de septiembre_");
    expect(text).toContain(
      "1️⃣ [GPT\\-6 \\(beta\\) llega\\!](https://kernelia.dev/n/x-1?utm_source=telegram)",
    );
    expect(text).toContain("OpenAI lo anuncia\\.");
    expect(text).not.toContain("Más");
    expect(text).toContain(
      "[Todas las noticias en kernelia\\.dev](https://kernelia.dev/?utm_source=telegram)",
    );
  });

  it("titles the afternoon digest accordingly", () => {
    const text = formatDigestMessage({
      slot: "afternoon",
      now: MORNING,
      items: [],
      homeLink: "https://k.dev",
    });
    expect(text.startsWith("🌆 *La IA de esta tarde*")).toBe(true);
  });
});

interface Spy {
  claims: number;
  released: string[];
  marked: Array<{ externalId: string; articleIds: string[] }>;
  recorded: string[];
  sent: Array<{ text: string; linkPreviewUrl?: string }>;
}

function deps(overrides: Partial<RunDigestOptions> = {}): { opts: RunDigestOptions; spy: Spy } {
  const spy: Spy = { claims: 0, released: [], marked: [], recorded: [], sent: [] };
  const opts: RunDigestOptions = {
    enabled: true,
    now: () => MORNING,
    claim: async () => {
      spy.claims++;
      return "claim-1";
    },
    release: async (id) => {
      spy.released.push(id);
    },
    markSent: async (p) => {
      spy.marked.push({ externalId: p.externalId, articleIds: p.articleIds });
    },
    listCandidates: async () => [cand("a", "Verge"), cand("b", "Wired")],
    record: async (p) => {
      spy.recorded.push(p.articleId);
      return true;
    },
    send: async (p) => {
      spy.sent.push(p);
      return { messageId: "777" };
    },
    ...overrides,
  };
  return { opts, spy };
}

describe("runDigest", () => {
  it("sends the due slot, records every article and finalises the claim", async () => {
    const { opts, spy } = deps();
    const summary = await runDigest(opts);
    expect(summary).toMatchObject({
      outcome: "sent",
      slot: "morning",
      digestDate: "2026-09-25",
      externalId: "777",
    });
    expect(spy.sent).toHaveLength(1);
    expect(spy.sent[0]?.linkPreviewUrl).toMatch(
      /\/n\/titular-a-a0000000[0-9a-f]{4}\?utm_source=telegram&utm_medium=social&utm_campaign=digest_morning$/,
    );
    expect(spy.marked).toEqual([{ externalId: "777", articleIds: summary.articleIds }]);
    expect(spy.recorded).toEqual(summary.articleIds);
    expect(spy.released).toEqual([]);
    expect(digestStatus(summary)).toBe("ok");
  });

  it("does nothing before 08:00 unless forced", async () => {
    const early = deps({ now: () => EARLY });
    expect((await runDigest(early.opts)).outcome).toBe("not_due");
    expect(early.spy.claims).toBe(0);

    const forced = deps({ now: () => EARLY, forceSlot: "morning" });
    expect((await runDigest(forced.opts)).outcome).toBe("sent");
  });

  it("never sends a slot another tick already claimed", async () => {
    const { opts, spy } = deps({ claim: async () => null });
    expect((await runDigest(opts)).outcome).toBe("already_sent");
    expect(spy.sent).toEqual([]);
  });

  it("gives the slot back when there is nothing to send", async () => {
    const { opts, spy } = deps({ listCandidates: async () => [] });
    expect((await runDigest(opts)).outcome).toBe("no_articles");
    expect(spy.released).toEqual(["claim-1"]);
    expect(spy.sent).toEqual([]);
  });

  it("releases the claim when Telegram rejects the message, so a later tick retries", async () => {
    const { opts, spy } = deps({
      send: async () => {
        throw new Error("Telegram 502");
      },
    });
    const summary = await runDigest(opts);
    expect(summary).toMatchObject({ outcome: "failed", error: "Telegram 502" });
    expect(spy.released).toEqual(["claim-1"]);
    expect(spy.recorded).toEqual([]);
    expect(digestStatus(summary)).toBe("failed");
  });

  it("never releases a claim once the message is out, even if bookkeeping fails", async () => {
    let attempts = 0;
    const { opts, spy } = deps({
      markSent: async () => {
        attempts++;
        throw new Error("db down");
      },
    });
    const summary = await runDigest(opts);
    expect(attempts).toBe(2); // one retry
    expect(summary).toMatchObject({ outcome: "sent", externalId: "777", error: "db down" });
    expect(spy.released).toEqual([]);
    expect(digestStatus(summary)).toBe("partial");
  });

  it("is a no-op when broadcasting is disabled", async () => {
    const { opts, spy } = deps({ enabled: false });
    expect((await runDigest(opts)).outcome).toBe("disabled");
    expect(spy.claims).toBe(0);
  });
});
