import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { localeAlternates, localizedUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "newsletter" });
  return {
    title: t("confirm.title"),
    description: t("confirm.body"),
    alternates: {
      canonical: localizedUrl(locale, "/newsletter/confirm"),
      languages: localeAlternates("/newsletter/confirm"),
    },
    robots: { index: false, follow: false },
  };
}

/**
 * Confirmation landing for the double-opt-in flow.
 *
 * The signup email links HERE (a plain GET to a server-rendered page). Email
 * scanners (Outlook, Defender, Mimecast), link-preview bots and browser
 * prefetch can hit this URL — it does NOT mutate. The actual confirm
 * happens when the recipient clicks "Confirm subscription", which submits
 * a form via POST to `/api/newsletter/confirm`. The endpoint redirects to
 * `/newsletter/confirmed` on success.
 *
 * Without this barrier, anyone could subscribe a third party's email
 * (spoofed signup) — Outlook would pre-fetch the confirm link and
 * activate the subscription before the real owner sees the message,
 * defeating the double-opt-in guarantee.
 */
export default async function NewsletterConfirmPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const sp = await searchParams;
  const tokenRaw = sp.token;
  const token = typeof tokenRaw === "string" ? tokenRaw : "";

  const t = await getTranslations("newsletter");
  return (
    <article className="mx-auto max-w-xl space-y-6 py-12 text-center">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("confirm.title")}</h1>
      <p className="text-base text-[color:var(--color-muted-foreground)]">{t("confirm.body")}</p>
      <form
        method="post"
        action="/api/newsletter/confirm"
        className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
      >
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="lang" value={locale} />
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-md bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-[color:var(--color-accent-foreground,white)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/60"
        >
          {t("confirm.cta")}
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2 text-sm font-medium transition hover:bg-[color:var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
        >
          {t("confirm.cancel")}
        </Link>
      </form>
    </article>
  );
}
