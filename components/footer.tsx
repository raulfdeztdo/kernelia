import { getTranslations } from "next-intl/server";

export async function Footer() {
  const t = await getTranslations("footer");
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t border-[color:var(--color-border)]">
      <div className="container mx-auto flex flex-col gap-2 px-4 py-8 text-sm text-[color:var(--color-muted-foreground)] sm:flex-row sm:items-center sm:justify-between">
        <span>{t("tagline")}</span>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/raulfdeztdo/kernelia"
            target="_blank"
            rel="noreferrer"
            className="hover:text-[color:var(--color-foreground)]"
          >
            {t("source")}
          </a>
          <span>{t("rights", { year })}</span>
        </div>
      </div>
    </footer>
  );
}
