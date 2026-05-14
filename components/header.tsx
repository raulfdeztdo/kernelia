import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { SearchBox } from "@/components/search-box";

export async function Header() {
  const t = await getTranslations("header");

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

        <div className="order-3 w-full md:order-2 md:flex-1">
          <SearchBox
            placeholder={t("searchPlaceholder")}
            ariaLabel={t("searchAria")}
          />
        </div>

        <div className="order-2 ml-auto shrink-0 md:order-3">
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
      className="h-7 w-7 shrink-0 text-[color:var(--color-accent)]"
      fill="currentColor"
      aria-hidden
    >
      <polygon points="377,74 316,74 167,240 167,178 125,178 125,351" />
      <polygon points="210,291 311,390 372,390 240,259" />
    </svg>
  );
}
