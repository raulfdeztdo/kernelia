"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { cn } from "@/lib/utils";

export function LocaleSwitcher() {
  const t = useTranslations("header");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function onChange(nextLocale: Locale) {
    if (nextLocale === locale) return;
    startTransition(() => {
      router.replace(pathname, { locale: nextLocale });
    });
  }

  return (
    <div
      role="group"
      aria-label={t("languageLabel")}
      className="flex items-center gap-1"
    >
      {routing.locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          disabled={isPending}
          aria-current={l === locale ? "page" : undefined}
          lang={l}
          className={cn(
            "rounded px-2 py-1 text-xs font-medium uppercase tracking-wider transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40 disabled:cursor-not-allowed disabled:opacity-50",
            l === locale
              ? "bg-[color:var(--color-primary)] text-[color:var(--color-primary-foreground)]"
              : "text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]",
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
