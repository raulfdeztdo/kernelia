import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/routing";
import { listSourcesPublic } from "@/db/queries/sources";
import { CATEGORY_SLUGS } from "@/lib/categories";
import { localeAlternates, localizedUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

interface AboutPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: AboutPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "about" });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: {
      canonical: localizedUrl(locale, "/about"),
      languages: localeAlternates("/about"),
    },
    openGraph: {
      title: t("title"),
      description: t("intro"),
      url: localizedUrl(locale, "/about"),
    },
  };
}

export default async function AboutPage({ params }: AboutPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("about");
  const tCategories = await getTranslations("categories");

  let sources: { name: string; url: string }[] = [];
  try {
    sources = await listSourcesPublic();
  } catch {
    // Falls through to an empty sources list — still renders the rest.
  }

  return (
    <article className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("title")}</h1>
        <p className="text-base text-[color:var(--color-muted-foreground)]">{t("intro")}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">{t("howItWorks.title")}</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[color:var(--color-foreground)]/90 marker:text-[color:var(--color-muted-foreground)]">
          <li>{t("howItWorks.step1")}</li>
          <li>{t("howItWorks.step2")}</li>
          <li>{t("howItWorks.step3")}</li>
          <li>{t("howItWorks.step4")}</li>
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">{t("categories.title")}</h2>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">
          {t("categories.body")}
        </p>
        <ul className="flex flex-wrap gap-2">
          {CATEGORY_SLUGS.map((slug) => (
            <li
              key={slug}
              className="rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1 text-xs"
              style={{ borderColor: `color-mix(in oklch, var(--color-cat-${slug}) 35%, transparent)` }}
            >
              <span
                aria-hidden
                className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                style={{ background: `var(--color-cat-${slug})` }}
              />
              {tCategories(slug)}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">{t("sources.title")}</h2>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">
          {t("sources.body")}
        </p>
        {sources.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {sources.map((s) => (
              <li key={s.url}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm transition hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
                >
                  {s.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">{t("limits.title")}</h2>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">{t("limits.body")}</p>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">{t("stack.title")}</h2>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">{t("stack.body")}</p>
      </section>
    </article>
  );
}
