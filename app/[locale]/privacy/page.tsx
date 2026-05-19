import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { localeAlternates, localizedUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * Last update date for the privacy notice — exported so the page and
 * any future PR that edits the copy can bump it in one place. ISO so
 * the rendered string can be formatted per-locale below.
 */
export const PRIVACY_LAST_UPDATED = "2026-05-19";

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "privacy" });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: {
      canonical: localizedUrl(locale, "/privacy"),
      languages: localeAlternates("/privacy"),
    },
    openGraph: {
      title: t("title"),
      description: t("intro"),
      url: localizedUrl(locale, "/privacy"),
    },
  };
}

const SECTIONS = [
  "newsletter",
  "tracking",
  "retention",
  "thirdParties",
  "cookies",
] as const;

/**
 * Static privacy notice. Plain markup, no DB queries — the only
 * dynamic bit is the "last updated" date which comes from a constant
 * exported above so we don't accidentally show today's date and
 * mislead readers about when the policy actually changed.
 *
 * The wording lives in `messages/{es,en}.json → privacy.*`. Keep both
 * locales in sync; this is the most user-facing page outside the
 * feed and the digest, and discrepancies look careless.
 */
export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations("privacy");
  const lastUpdated = new Date(PRIVACY_LAST_UPDATED).toLocaleDateString(
    locale === "en" ? "en-GB" : "es-ES",
    { day: "2-digit", month: "long", year: "numeric" },
  );

  return (
    <article className="mx-auto max-w-3xl space-y-10 py-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("title")}</h1>
        <p className="text-base text-[color:var(--color-muted-foreground)]">{t("intro")}</p>
        <p className="text-xs text-[color:var(--color-muted-foreground)]/80">
          {t("lastUpdated", { date: lastUpdated })}
        </p>
      </header>

      {SECTIONS.map((slug) => (
        <section key={slug} className="space-y-2">
          <h2 className="text-xl font-semibold tracking-tight">
            {t(`sections.${slug}.title`)}
          </h2>
          <p className="text-sm leading-relaxed text-[color:var(--color-foreground)]/90">
            {t(`sections.${slug}.body`)}
          </p>
        </section>
      ))}

      {/* Contact section — rendered separately to allow a mailto link */}
      <section className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">
          {t("sections.contact.title")}
        </h2>
        <p className="text-sm leading-relaxed text-[color:var(--color-foreground)]/90">
          {t.rich("sections.contact.body", {
            email: (chunks) => (
              <a
                href="mailto:admin@kernelia.dev"
                className="rounded font-medium text-[color:var(--color-foreground)] underline-offset-4 transition hover:text-[color:var(--color-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </section>

      <footer>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2 text-sm font-medium transition hover:bg-[color:var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
        >
          {t("backHome")}
        </Link>
      </footer>
    </article>
  );
}
