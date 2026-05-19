import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { localeAlternates, localizedUrl } from "@/lib/site";
import { CATEGORY_SLUGS } from "@/lib/categories";
import { PUBLIC_HIDDEN_CATEGORY_SLUG } from "@/db/queries/articles";
import { getActiveSubscriberByUnsubscribeToken } from "@/db/queries/newsletter";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "newsletter.preferences" });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: {
      canonical: localizedUrl(locale, "/newsletter/preferences"),
      languages: localeAlternates("/newsletter/preferences"),
    },
    // Token-scoped page reachable only via email link — keep search
    // engines out so individual subscribers' tokens don't leak in
    // crawler caches.
    robots: { index: false, follow: false },
  };
}

/**
 * Token-scoped preferences page for the weekly digest.
 *
 * Reads the long-lived unsubscribe token from the query string (it's the
 * same secret already embedded in every digest's unsubscribe link, so the
 * subscriber doesn't need a second one). Resolves the row server-side via
 * `getActiveSubscriberByUnsubscribeToken` and pre-ticks the checkboxes
 * with the stored selection. Empty selection means "all categories".
 *
 * The form POSTs to `/api/newsletter/preferences`, which performs the
 * mutation and redirects back here with `?saved=…` so the same page
 * renders the success / error banner. POST-only mutation keeps email
 * scanners from clobbering preferences on a pre-fetch — same rationale
 * as the unsubscribe flow.
 *
 * Uniform fallback: if the token doesn't match an active subscriber, we
 * still render the form (empty selection, banner shows `?saved=invalid`
 * iff the user submitted) so the page can't be used as an oracle to
 * confirm which tokens are live.
 */
export default async function NewsletterPreferencesPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const sp = await searchParams;
  const tokenRaw = sp.token;
  const token = typeof tokenRaw === "string" ? tokenRaw : "";
  const savedRaw = sp.saved;
  const saved = typeof savedRaw === "string" ? savedRaw : null;

  const [t, tCategories] = await Promise.all([
    getTranslations("newsletter.preferences"),
    getTranslations("categories"),
  ]);

  // Lookup happens only when a token is present — saves a query when
  // someone lands on the bare URL. The `Set` of pre-ticked slugs is
  // empty either way, which renders as "all categories selected"
  // semantically (no filter).
  const subscriber = token ? await getActiveSubscriberByUnsubscribeToken(token) : null;
  const initialSelection = new Set<string>(subscriber?.preferredCategories ?? []);

  // Same publicly-visible slug list as everywhere else — `other` is the
  // LLM's catch-all and not user-facing.
  const visibleSlugs = CATEGORY_SLUGS.filter((s) => s !== PUBLIC_HIDDEN_CATEGORY_SLUG);

  return (
    <article className="mx-auto max-w-xl space-y-6 py-12">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("title")}</h1>
        <p className="text-base text-[color:var(--color-muted-foreground)]">{t("intro")}</p>
      </header>

      {saved === "1" ? (
        <p
          role="status"
          className="rounded-md border border-[color:var(--color-accent)]/40 bg-[color:var(--color-accent)]/10 px-4 py-2 text-center text-sm text-[color:var(--color-accent)]"
        >
          {t("saved")}
        </p>
      ) : null}
      {saved === "invalid" ? (
        <p
          role="alert"
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-center text-sm text-amber-500"
        >
          {t("invalid")}
        </p>
      ) : null}
      {saved === "error" ? (
        <p
          role="alert"
          className="rounded-md border border-red-500/40 bg-red-500/10 px-4 py-2 text-center text-sm text-red-500"
        >
          {t("error")}
        </p>
      ) : null}

      <form
        method="post"
        action="/api/newsletter/preferences"
        className="space-y-4 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4"
      >
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="lang" value={locale} />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t("categoriesLabel")}</legend>
          <div className="flex flex-wrap gap-2">
            {visibleSlugs.map((slug) => {
              const checked = initialSelection.has(slug);
              return (
                <label
                  key={slug}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ${
                    checked
                      ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)]/15 text-[color:var(--color-accent)]"
                      : "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:border-[color:var(--color-accent)]/60"
                  }`}
                >
                  {/*
                   * Native checkbox so the page works without JS. The
                   * surrounding label is the styled UI; we hide the
                   * actual input visually with `sr-only` but keep it
                   * focusable for keyboard users.
                   */}
                  <input
                    type="checkbox"
                    name="preferredCategories"
                    value={slug}
                    defaultChecked={checked}
                    className="sr-only"
                  />
                  {tCategories(slug)}
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-md bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-[color:var(--color-accent-foreground,white)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/60"
          >
            {t("save")}
          </button>
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-4 py-2 text-sm font-medium transition hover:bg-[color:var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
          >
            {t("backHome")}
          </Link>
        </div>
      </form>
    </article>
  );
}
