import { getTranslations } from "next-intl/server";

/**
 * Accessibility helper: invisible until focused, lets keyboard users
 * jump straight to <main> without tabbing through the header.
 */
export async function SkipLink() {
  const t = await getTranslations("a11y");
  return (
    <a
      href="#main"
      className="sr-only fixed left-3 top-3 z-50 rounded-md bg-[color:var(--color-accent)] px-3 py-2 text-sm font-semibold text-[color:var(--color-accent-foreground)] outline-none focus:not-sr-only focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
    >
      {t("skipToContent")}
    </a>
  );
}
