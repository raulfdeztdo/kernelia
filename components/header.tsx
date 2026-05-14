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
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6 text-[color:var(--color-accent)]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m12 3 1.9 4 4.1.4-3 2.9.9 4.7L12 12.7l-3.9 2.3.9-4.7-3-2.9 4.1-.4Z" />
      <path d="M5 19c2-1 5-1 7-1s5 0 7 1" />
    </svg>
  );
}
