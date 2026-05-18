import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getAllPublicChannels,
  getBlueskyChannel,
  getMastodonChannel,
  getTelegramChannel,
} from "@/lib/broadcast-channels";

/**
 * `lib/broadcast-channels.ts` is the single source of truth for the
 * public profile URLs surfaced in the footer + /about. It reads
 * `process.env` directly, so each spec snapshots + restores the four
 * env vars it touches to keep tests independent.
 */
const ENV_KEYS = [
  "MASTODON_INSTANCE_URL",
  "MASTODON_PROFILE_USERNAME",
  "BLUESKY_IDENTIFIER",
  "TELEGRAM_CHAT_ID",
] as const;

describe("broadcast channels (public-URL resolver)", () => {
  const snapshots: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) snapshots[k] = process.env[k];
    // Wipe so the default-channel resolution starts from a known clean state.
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (snapshots[k] === undefined) delete process.env[k];
      else process.env[k] = snapshots[k];
    }
  });

  describe("getMastodonChannel", () => {
    it("returns null when MASTODON_INSTANCE_URL is unset", () => {
      expect(getMastodonChannel()).toBeNull();
    });

    it("uses MASTODON_PROFILE_USERNAME when provided", () => {
      process.env.MASTODON_INSTANCE_URL = "https://fosstodon.org";
      process.env.MASTODON_PROFILE_USERNAME = "kernelia_news";
      expect(getMastodonChannel()).toEqual({
        platform: "mastodon",
        handle: "@kernelia_news@fosstodon.org",
        url: "https://fosstodon.org/@kernelia_news",
      });
    });

    it("falls back to the documented default username ('kernelia')", () => {
      process.env.MASTODON_INSTANCE_URL = "https://fosstodon.org";
      const channel = getMastodonChannel();
      expect(channel?.handle).toBe("@kernelia@fosstodon.org");
      expect(channel?.url).toBe("https://fosstodon.org/@kernelia");
    });

    it("strips a trailing slash from the instance URL", () => {
      process.env.MASTODON_INSTANCE_URL = "https://fosstodon.org/";
      const channel = getMastodonChannel();
      // Without the strip, the URL would be "https://fosstodon.org//@kernelia"
      // and the handle would have a stray slash too.
      expect(channel?.url).toBe("https://fosstodon.org/@kernelia");
      expect(channel?.handle).toBe("@kernelia@fosstodon.org");
    });
  });

  describe("getBlueskyChannel", () => {
    it("returns null when BLUESKY_IDENTIFIER is unset", () => {
      expect(getBlueskyChannel()).toBeNull();
    });

    it("uses the identifier as both the handle and the URL slug", () => {
      process.env.BLUESKY_IDENTIFIER = "kernelia.dev";
      expect(getBlueskyChannel()).toEqual({
        platform: "bluesky",
        handle: "kernelia.dev",
        url: "https://bsky.app/profile/kernelia.dev",
      });
    });

    it("works with the default bsky.social handle (no custom domain yet)", () => {
      process.env.BLUESKY_IDENTIFIER = "kernelia.bsky.social";
      const channel = getBlueskyChannel();
      expect(channel?.url).toBe("https://bsky.app/profile/kernelia.bsky.social");
    });
  });

  describe("getTelegramChannel", () => {
    it("returns null when TELEGRAM_CHAT_ID is unset", () => {
      expect(getTelegramChannel()).toBeNull();
    });

    it("returns the public-channel URL for @username form", () => {
      process.env.TELEGRAM_CHAT_ID = "@kernelia";
      expect(getTelegramChannel()).toEqual({
        platform: "telegram",
        handle: "@kernelia",
        url: "https://t.me/kernelia",
      });
    });

    it("returns null for numeric (private) chat ids — no public URL exists", () => {
      // Private channels expose -100xxxxxxxxxx ids that t.me can't resolve.
      // Showing them in the footer would be a broken link.
      process.env.TELEGRAM_CHAT_ID = "-1001234567890";
      expect(getTelegramChannel()).toBeNull();
    });
  });

  it("getAllPublicChannels omits unconfigured channels and keeps display order", () => {
    process.env.MASTODON_INSTANCE_URL = "https://fosstodon.org";
    process.env.TELEGRAM_CHAT_ID = "@kernelia";
    // BLUESKY_IDENTIFIER intentionally unset.
    const channels = getAllPublicChannels();
    expect(channels.map((c) => c.platform)).toEqual(["mastodon", "telegram"]);
  });
});
