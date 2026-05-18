/**
 * Public-facing URLs of the Kernelia broadcaster accounts. Derived from the
 * same env vars the bot uses to *post* (`MASTODON_*`, `BLUESKY_IDENTIFIER`,
 * `TELEGRAM_CHAT_ID`) so the "Síguenos en…" links and the bot writes can
 * never drift out of sync.
 *
 * Server-only — these read `process.env`. Components call this from a
 * server context and pass the resolved values down to client islands.
 *
 * Each helper returns `null` when its env vars aren't configured. That
 * lets us deploy partially (e.g. only Mastodon set up so far) and only
 * show the channels that actually work, without a separate config flag.
 */

export interface PublicChannel {
  platform: "mastodon" | "bluesky" | "telegram";
  /** "@kernelia@fosstodon.org", "kernelia.dev", "@kernelia". For display. */
  handle: string;
  /** Absolute URL of the public profile / channel. */
  url: string;
}

/**
 * `MASTODON_INSTANCE_URL` + the username derived from the access-token
 * setup. We can't read the username from an env var (the token doesn't
 * encode it), so we accept an optional `MASTODON_PROFILE_USERNAME`. If
 * unset we fall back to "kernelia" — the username we documented for
 * setup. Operators with a different username can override the env.
 */
export function getMastodonChannel(): PublicChannel | null {
  const instance = process.env.MASTODON_INSTANCE_URL?.trim();
  if (!instance) return null;
  const username = process.env.MASTODON_PROFILE_USERNAME?.trim() || "kernelia";
  const base = instance.replace(/\/$/, "");
  // e.g. "fosstodon.org" from "https://fosstodon.org"
  const host = base.replace(/^https?:\/\//, "");
  return {
    platform: "mastodon",
    handle: `@${username}@${host}`,
    url: `${base}/@${username}`,
  };
}

/**
 * `BLUESKY_IDENTIFIER` is the handle itself (e.g. "kernelia.dev"). The
 * public profile URL is the canonical bsky.app/profile/<handle> form;
 * Bluesky resolves it regardless of which PDS hosts the account.
 */
export function getBlueskyChannel(): PublicChannel | null {
  const identifier = process.env.BLUESKY_IDENTIFIER?.trim();
  if (!identifier) return null;
  return {
    platform: "bluesky",
    handle: identifier,
    url: `https://bsky.app/profile/${encodeURIComponent(identifier)}`,
  };
}

/**
 * `TELEGRAM_CHAT_ID` can be either `@channelname` (public) or `-100xxxx`
 * (private/numeric). Only public channels have a public profile URL —
 * for numeric ids we return `null` so the UI hides the link instead of
 * showing a broken `t.me/-100…`.
 */
export function getTelegramChannel(): PublicChannel | null {
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim();
  if (!chatId) return null;
  if (!chatId.startsWith("@")) return null;
  const username = chatId.slice(1);
  if (!username) return null;
  return {
    platform: "telegram",
    handle: chatId,
    url: `https://t.me/${encodeURIComponent(username)}`,
  };
}

/**
 * Convenience: returns every configured channel in display order.
 * Channels with missing env vars are silently filtered out.
 */
export function getAllPublicChannels(): PublicChannel[] {
  return [getMastodonChannel(), getBlueskyChannel(), getTelegramChannel()].filter(
    (c): c is PublicChannel => c !== null,
  );
}
