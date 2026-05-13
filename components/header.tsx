import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LocaleSwitcher } from "@/components/locale-switcher";

export async function Header() {
  const t = await getTranslations("header");

  return (
    <header className="border-b border-[color:var(--color-border)]">
      <div className="container mx-auto flex items-center justify-between px-4 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-xl font-semibold tracking-tight">Kernelia</span>
          <span className="hidden text-sm text-[color:var(--color-muted-foreground)] sm:inline">
            {t("tagline")}
          </span>
        </Link>
        <LocaleSwitcher />
      </div>
    </header>
  );
}
