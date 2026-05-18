import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SearchBox } from "@/components/search-box";
import { getAllPublicChannels } from "@/lib/broadcast-channels";
import { brandColor, platformIcon } from "@/components/social-icons";

export async function Header() {
  const t = await getTranslations("header");
  // Same resolver the footer used to use — moved up here so the social
  // links sit alongside the tagline, where they read as part of the brand
  // identity instead of being buried at the bottom of the page.
  const channels = getAllPublicChannels();

  return (
    <header className="sticky top-0 z-30 border-b border-[color:var(--color-border)] bg-[color:var(--color-background)]/85 backdrop-blur supports-[backdrop-filter]:bg-[color:var(--color-background)]/65">
      <div className="container mx-auto flex flex-wrap items-center gap-3 px-4 py-3 md:gap-6">
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 outline-none focus-visible:underline"
        >
          <LogoMark />
          <span className="text-lg font-semibold tracking-tight">Kernelia</span>
          <span className="hidden text-xs text-[color:var(--color-muted-foreground)] md:inline">
            {t("tagline")}
          </span>
        </Link>

        {channels.length > 0 ? (
          <nav
            aria-label={t("socialAria")}
            className="order-2 flex shrink-0 items-center gap-0.5 md:order-2"
          >
            {channels.map((c) => (
              // The CSS variable `--brand` carries the platform's official
              // hex (Mastodon #6364FF, Bluesky #0285FF, Telegram #26A5E4) so
              // hover paints the icon in the platform color. Resting state
              // is the same muted tone the footer used to render.
              <a
                key={c.platform}
                href={c.url}
                target="_blank"
                rel="noreferrer"
                aria-label={c.platform}
                title={c.handle}
                style={{ "--brand": brandColor(c.platform) } as React.CSSProperties}
                className="inline-flex size-8 items-center justify-center rounded-md text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-2)] hover:text-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
              >
                {platformIcon(c.platform, "size-4")}
              </a>
            ))}
          </nav>
        ) : null}

        <div className="order-4 w-full md:order-3 md:flex-1">
          {/*
            SearchBox calls useSearchParams(). Wrapping it in Suspense
            means Next can render the rest of the page server-side
            while this slot waits for query params, instead of bailing
            the WHOLE page out to client-side rendering.
          */}
          <Suspense
            fallback={
              <div
                aria-hidden
                className="h-9 w-full rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)]"
              />
            }
          >
            <SearchBox
              placeholder={t("searchPlaceholder")}
              ariaLabel={t("searchAria")}
            />
          </Suspense>
        </div>

        <div className="order-3 ml-auto shrink-0 md:order-4">
          <LocaleSwitcher />
        </div>
      </div>
    </header>
  );
}

function LogoMark() {
  // The Kernelia "K" wordmark from /media/logo-kernelia.svg, inlined so it
  // inherits the accent color via `currentColor`. Same paths as the favicon
  // (app/icon.svg) so the brand is consistent across header + tab.
  return (
    <svg
      viewBox="0 0 460 470"
      className="size-7 shrink-0 text-[color:var(--color-accent)]"
      fill="currentColor"
      aria-hidden
    >
      <polygon points="377,74 316,74 167,240 167,178 125,178 125,351" />
      <polygon points="210,291 311,390 372,390 240,259" />
    </svg>
  );
}
