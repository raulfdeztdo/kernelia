import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("footer");

  return (
    <footer className="border-t border-[color:var(--color-border)]">
      <div className="container mx-auto flex flex-col gap-1 px-4 py-6 text-sm text-[color:var(--color-muted-foreground)] sm:flex-row sm:items-center sm:justify-between">
        <span>{t("builtWith")}</span>
        <a
          href="https://github.com/"
          target="_blank"
          rel="noreferrer"
          className="hover:text-[color:var(--color-foreground)]"
        >
          {t("source")}
        </a>
      </div>
    </footer>
  );
}
