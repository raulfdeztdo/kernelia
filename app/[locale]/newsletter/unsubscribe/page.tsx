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
    title: t("unsubscribe.title"),
    description: t("unsubscribe.body"),
    alternates: {
      canonical: localizedUrl(locale, "/newsletter/unsubscribe"),
      languages: localeAlternates("/newsletter/unsubscribe"),
    },
    // Confirmation page reachable only via email link — keep it off search
    // engines so it doesn't accidentally rank for "unsubscribe kernelia".
    robots: { index: false, follow: false },
  };
}

/**
 * Confirmation page for the unsubscribe flow.
 *
 * The digest email links here (a plain GET to a server-rendered page).
 * Email scanners, link-preview bots and browser prefetch can hit this URL
 * all they want — it does NOT mutate. The actual unsubscribe happens when
 * the recipient clicks "Confirm unsubscribe", which submits a form via
 * POST to `/api/newsletter/unsubscribe`. The endpoint redirects to
 * `/newsletter/unsubscribed` on success.
 *
 * If the link arrives without a token, we render the same form pointing at
 * the endpoint, which itself renders the "unsubscribed" page either way —
 * so we never leak whether a specific token is valid.
 */
export default async function NewsletterUnsubscribePage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const sp = await searchParams;
  const tokenRaw = sp.token;
  const token = typeof tokenRaw === "string" ? tokenRaw : "";

  const t = await getTranslations("newsletter");
  return (
    <article className="mx-auto max-w-xl space-y-6 py-12 text-center">
      <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
        {t("unsubscribe.title")}
      </h1>
      <p className="text-base text-[color:var(--color-muted-foreground)]">
        {t("unsubscribe.body")}
      </p>
      <form
        method="post"
        action="/api/newsletter/unsubscribe"
        className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
      >
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="lang" value={locale} />
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-md bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-[color:var(--color-accent-foreground,white)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/60"
        >
          {t("unsubscribe.confirm")}
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2 text-sm font-medium transition hover:bg-[color:var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
        >
          {t("unsubscribe.cancel")}
        </Link>
      </form>
    </article>
  );
}
