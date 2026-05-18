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
    title: t("unsubscribed.title"),
    description: t("unsubscribed.body"),
    alternates: {
      canonical: localizedUrl(locale, "/newsletter/unsubscribed"),
      languages: localeAlternates("/newsletter/unsubscribed"),
    },
    robots: { index: false, follow: false },
  };
}

export default async function NewsletterUnsubscribedPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations("newsletter");
  return (
    <article className="mx-auto max-w-xl space-y-6 py-12 text-center">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("unsubscribed.title")}</h1>
      <p className="text-base text-[color:var(--color-muted-foreground)]">{t("unsubscribed.body")}</p>
      <Link
        href="/"
        className="inline-flex items-center justify-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2 text-sm font-medium transition hover:bg-[color:var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
      >
        {t("unsubscribed.backHome")}
      </Link>
    </article>
  );
}
