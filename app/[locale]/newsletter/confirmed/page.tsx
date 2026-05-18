import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { localeAlternates, localizedUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "newsletter" });
  return {
    title: t("confirmed.title"),
    description: t("confirmed.body"),
    alternates: {
      canonical: localizedUrl(locale, "/newsletter/confirmed"),
      languages: localeAlternates("/newsletter/confirmed"),
    },
    // No need to index the landing page of a flow nobody links to directly.
    robots: { index: false, follow: false },
  };
}

export default async function NewsletterConfirmedPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("newsletter");
  return (
    <article className="mx-auto max-w-xl space-y-6 py-12 text-center">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("confirmed.title")}</h1>
      <p className="text-base text-[color:var(--color-muted-foreground)]">{t("confirmed.body")}</p>
      <Link
        href="/"
        className="inline-flex items-center justify-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2 text-sm font-medium transition hover:bg-[color:var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
      >
        {t("confirmed.backHome")}
      </Link>
    </article>
  );
}
