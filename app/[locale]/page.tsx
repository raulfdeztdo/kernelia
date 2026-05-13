import { getTranslations, setRequestLocale } from "next-intl/server";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("home");

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("heading")}</h1>
        <p className="text-[color:var(--color-muted-foreground)]">{t("subheading")}</p>
      </header>
      <div className="rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-muted)] p-6 text-sm text-[color:var(--color-muted-foreground)]">
        {t("comingSoon")}
      </div>
    </section>
  );
}
