import { describe, expect, it } from "vitest";
import {
  buildAnalyticsEvent,
  detectDevice,
  isBotUserAgent,
  localeFromPath,
  normalizePath,
  referrerHost,
  visitorHash,
} from "@/lib/analytics/event";

/**
 * The beacon → row policy is what `/privacy` promises readers, so it is
 * pinned here: what we keep, what we drop, and that nothing identifying
 * (IP, UA) ever reaches the row.
 */

const CHROME_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const SECRET = "x".repeat(32);
const NOW = new Date("2026-09-25T10:00:00Z");

function build(
  payload: unknown,
  overrides: Partial<Parameters<typeof buildAnalyticsEvent>[0]> = {},
) {
  return buildAnalyticsEvent({
    payload,
    ip: "203.0.113.7",
    userAgent: CHROME_DESKTOP,
    country: "es",
    ownHost: "kernelia.dev",
    now: NOW,
    secret: SECRET,
    ...overrides,
  });
}

describe("isBotUserAgent", () => {
  it("flags crawlers, previewers, scripts and empty UAs", () => {
    for (const ua of [
      "Googlebot/2.1",
      "TelegramBot (like TwitterBot)",
      "Mozilla/5.0 HeadlessChrome/120",
      "curl/8.4.0",
      "python-requests/2.31",
      "",
    ]) {
      expect(isBotUserAgent(ua)).toBe(true);
    }
    expect(isBotUserAgent(null)).toBe(true);
  });

  it("lets real browsers through", () => {
    expect(isBotUserAgent(CHROME_DESKTOP)).toBe(false);
    expect(isBotUserAgent(IPHONE)).toBe(false);
  });
});

describe("detectDevice", () => {
  it("tells phones, tablets and desktops apart", () => {
    expect(detectDevice(IPHONE)).toBe("mobile");
    expect(detectDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari")).toBe("mobile");
    expect(detectDevice("Mozilla/5.0 (Linux; Android 14; SM-X710) Safari")).toBe("tablet");
    expect(detectDevice("Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)")).toBe("tablet");
    expect(detectDevice(CHROME_DESKTOP)).toBe("desktop");
  });
});

describe("normalizePath", () => {
  it("keeps only the pathname", () => {
    expect(normalizePath("/en/about?q=gpt#top")).toBe("/en/about");
    expect(normalizePath("/")).toBe("/");
  });

  it("rejects anything that is not a same-origin path", () => {
    expect(normalizePath("https://evil.example/x")).toBeNull();
    expect(normalizePath("//evil.example/x")).toBeNull();
    expect(normalizePath("about")).toBeNull();
  });

  it("caps the length", () => {
    expect(normalizePath(`/${"a".repeat(1000)}`)?.length).toBe(300);
  });
});

describe("localeFromPath", () => {
  it("maps the /en prefix to English and the rest to Spanish", () => {
    expect(localeFromPath("/en")).toBe("en");
    expect(localeFromPath("/en/about")).toBe("en");
    expect(localeFromPath("/")).toBe("es");
    expect(localeFromPath("/entrevistas")).toBe("es");
  });
});

describe("referrerHost", () => {
  it("returns the external host without www", () => {
    expect(referrerHost("https://www.google.com/search?q=x", "kernelia.dev")).toBe("google.com");
    expect(referrerHost("https://t.co/abc", "kernelia.dev")).toBe("t.co");
  });

  it("ignores our own host and garbage", () => {
    expect(referrerHost("https://kernelia.dev/en", "kernelia.dev")).toBeNull();
    expect(referrerHost("https://www.kernelia.dev/", "kernelia.dev")).toBeNull();
    expect(referrerHost("not a url", "kernelia.dev")).toBeNull();
    expect(referrerHost(undefined, "kernelia.dev")).toBeNull();
  });
});

describe("visitorHash", () => {
  const base = { secret: SECRET, day: "2026-09-25", ip: "203.0.113.7", userAgent: CHROME_DESKTOP };

  it("is stable within a day and 16 hex chars long", () => {
    expect(visitorHash(base)).toBe(visitorHash(base));
    expect(visitorHash(base)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("rotates across days, so visits cannot be linked day to day", () => {
    expect(visitorHash({ ...base, day: "2026-09-26" })).not.toBe(visitorHash(base));
  });

  it("differs per IP and per UA", () => {
    expect(visitorHash({ ...base, ip: "203.0.113.8" })).not.toBe(visitorHash(base));
    expect(visitorHash({ ...base, userAgent: IPHONE })).not.toBe(visitorHash(base));
  });
});

describe("buildAnalyticsEvent", () => {
  it("builds a pageview with attribution and no identifying data", () => {
    const res = build({
      e: "pageview",
      p: "/en/about?q=secret",
      r: "https://news.ycombinator.com/item?id=1",
      us: "Telegram",
      um: "social",
      uc: "digest",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row).toMatchObject({
      event: "pageview",
      path: "/en/about",
      locale: "en",
      referrerHost: "news.ycombinator.com",
      utmSource: "telegram",
      utmMedium: "social",
      utmCampaign: "digest",
      country: "ES",
      device: "desktop",
      target: null,
      articleId: null,
    });
    const serialized = JSON.stringify(res.row);
    expect(serialized).not.toContain("203.0.113.7");
    expect(serialized).not.toContain("Chrome");
  });

  it("builds outbound and cta events, dropping visit-level attribution", () => {
    const articleId = "3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b";
    const res = build({
      e: "outbound",
      p: "/",
      t: "TechCrunch.com",
      a: articleId,
      r: "https://google.com",
      us: "x",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.row).toMatchObject({
      event: "outbound",
      target: "techcrunch.com",
      articleId,
      referrerHost: null,
      utmSource: null,
    });

    const cta = build({ e: "cta", p: "/", t: "telegram" });
    expect(cta.ok && cta.row.target).toBe("telegram");
  });

  it("drops bots, malformed payloads and click events without a target", () => {
    expect(build({ e: "pageview", p: "/" }, { userAgent: "Googlebot" })).toEqual({
      ok: false,
      reason: "bot",
    });
    expect(build({ e: "hack", p: "/" })).toEqual({ ok: false, reason: "invalid" });
    expect(build({ e: "pageview", p: "https://x.y/" })).toEqual({ ok: false, reason: "invalid" });
    expect(build({ e: "pageview", p: "/", a: "not-a-uuid" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(build({ e: "cta", p: "/" })).toEqual({ ok: false, reason: "invalid" });
    expect(build("nope")).toEqual({ ok: false, reason: "invalid" });
  });

  it("refuses to hash without a secret", () => {
    expect(build({ e: "pageview", p: "/" }, { secret: "" })).toEqual({
      ok: false,
      reason: "no_secret",
    });
  });

  it("drops a malformed country header", () => {
    const res = build({ e: "pageview", p: "/" }, { country: "XX1" });
    expect(res.ok && res.row.country).toBeNull();
  });
});
