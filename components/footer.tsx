import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

function AboutLink({ label }: { label: string }) {
  return (
    <Link
      href="/about"
      className="rounded transition hover:text-[color:var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
    >
      {label}
    </Link>
  );
}

export async function Footer() {
  const t = await getTranslations("footer");
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t border-[color:var(--color-border)]">
      <div className="container mx-auto flex flex-col gap-2 px-4 py-8 text-sm text-[color:var(--color-muted-foreground)] sm:flex-row sm:items-center sm:justify-between">
        <span>{t("tagline")}</span>
        <nav aria-label="Footer" className="flex items-center gap-4">
          <AboutLink label={t("about")} />
          <a
            href="https://github.com/raulfdeztdo/kernelia"
            target="_blank"
            rel="noreferrer"
            className="rounded transition hover:text-[color:var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
          >
            {t("source")}
          </a>
          <span>{t("rights", { year })}</span>
        </nav>
      </div>
    </footer>
  );
}
