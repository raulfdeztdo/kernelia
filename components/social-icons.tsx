import { siBluesky, siGithub, siMastodon, siTelegram } from "simple-icons";

/**
 * Shared brand glyphs. Paths come from `simple-icons` (the canonical
 * brand-mark dataset) so every glyph is the actual official mark, not a
 * hand-traced approximation. The package exports tree-shakeable named
 * exports — Next's webpack only bundles the four icons we import.
 *
 * Icons render as inline SVGs that `fill="currentColor"` by default,
 * so the caller controls the color via `text-*` classes on the parent.
 * `aria-hidden` everywhere — the surrounding link/button already names
 * the destination for assistive tech.
 */

interface IconProps {
  /** Tailwind size class. Defaults to `size-3.5` (14px) — small UI glyph. */
  className?: string;
}

interface BrandData {
  /** Path `d` attribute as a single string. */
  path: string;
  /** Brand hex color without the `#` (e.g. `"6364FF"` for Mastodon). */
  hex: string;
  /** Human-readable name for the optional `<title>` element. */
  title: string;
}

const BRAND: Record<"github" | "mastodon" | "bluesky" | "telegram", BrandData> = {
  github: { path: siGithub.path, hex: siGithub.hex, title: siGithub.title },
  mastodon: { path: siMastodon.path, hex: siMastodon.hex, title: siMastodon.title },
  bluesky: { path: siBluesky.path, hex: siBluesky.hex, title: siBluesky.title },
  telegram: { path: siTelegram.path, hex: siTelegram.hex, title: siTelegram.title },
};

/**
 * Returns the official brand hex (with `#` prefix) for a given platform.
 * Useful when a caller wants to drive a `--brand` CSS variable for hover
 * states (the header puts a brand-color hover on the social links).
 */
export function brandColor(platform: "mastodon" | "bluesky" | "telegram" | "github"): string {
  return `#${BRAND[platform].hex}`;
}

function BrandSvg({
  data,
  className,
}: {
  data: BrandData;
  className: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d={data.path} />
    </svg>
  );
}

export function GitHubIcon({ className = "size-3.5" }: IconProps) {
  return <BrandSvg data={BRAND.github} className={className} />;
}

export function MastodonIcon({ className = "size-3.5" }: IconProps) {
  return <BrandSvg data={BRAND.mastodon} className={className} />;
}

export function BlueskyIcon({ className = "size-3.5" }: IconProps) {
  return <BrandSvg data={BRAND.bluesky} className={className} />;
}

export function TelegramIcon({ className = "size-3.5" }: IconProps) {
  return <BrandSvg data={BRAND.telegram} className={className} />;
}

/**
 * Lookup helper for code that has a `PublicChannel.platform` value in hand
 * and just needs the right glyph for it. Keeps render code branch-free.
 */
export function platformIcon(
  platform: "mastodon" | "bluesky" | "telegram",
  className?: string,
) {
  switch (platform) {
    case "mastodon":
      return <MastodonIcon className={className} />;
    case "bluesky":
      return <BlueskyIcon className={className} />;
    case "telegram":
      return <TelegramIcon className={className} />;
  }
}
