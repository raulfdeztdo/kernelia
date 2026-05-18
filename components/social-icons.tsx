/**
 * Shared brand glyphs for the footer and /about subscribe block.
 *
 * Hand-rolled inline SVGs (same convention as the wordmark in `header.tsx`
 * and the share buttons in `share-buttons.tsx`) so the public bundle
 * doesn't ship a brand-icon library for four glyphs. Every icon fills with
 * `currentColor` and exposes the same `viewBox` size policy (16 or 24,
 * whatever the official mark uses), which means a single
 * `className="size-3.5"` (or whatever) at the call site renders all of
 * them at the same visual weight.
 *
 * `aria-hidden` everywhere — these are decorative; the surrounding
 * link / button already has its accessible name.
 */

interface IconProps {
  /** Tailwind size class. Defaults to `size-3.5` (14px) — small UI glyph. */
  className?: string;
}

export function GitHubIcon({ className = "size-3.5" }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

export function MastodonIcon({ className = "size-3.5" }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M21.58 13.913c-.29 1.469-2.592 3.121-5.238 3.435-1.379.164-2.737.314-4.185.247-2.368-.108-4.236-.563-4.236-.563 0 .231.014.45.043.656.307 2.332 2.314 2.471 4.215 2.536 1.92.066 3.629-.473 3.629-.473l.079 1.741s-1.343.72-3.74.853c-1.321.072-2.961-.033-4.872-.539C2.107 20.708.392 16.291.131 11.81-.001 9.493-.041 7.31.039 5.49.302 1.04 3.214.103 6.288.103c5.077 0 6.93.103 9.42.103 5.026 0 7.95 1.547 8.292 5.42.094 1.067.115 2.158.115 3.273 0 1.83-.181 3.502-.535 5.014z" />
    </svg>
  );
}

export function BlueskyIcon({ className = "size-3.5" }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.789.624-6.478 0-.69-.139-1.861-.902-2.206-.659-.298-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z" />
    </svg>
  );
}

export function TelegramIcon({ className = "size-3.5" }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
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
