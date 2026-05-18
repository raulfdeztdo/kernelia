import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/routing";
import { getPublicStats } from "@/lib/stats";
import { localeAlternates, localizedUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

interface StatsPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: StatsPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "stats" });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: {
      canonical: localizedUrl(locale, "/stats"),
      languages: localeAlternates("/stats"),
    },
    openGraph: {
      title: t("title"),
      description: t("intro"),
      url: localizedUrl(locale, "/stats"),
    },
  };
}

export default async function StatsPage({ params }: StatsPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const [t, stats] = await Promise.all([getTranslations("stats"), getPublicStats()]);
  const neverLabel = t("activity.never");

  return (
    <article className="mx-auto max-w-3xl space-y-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("title")}</h1>
        <p className="text-base text-[color:var(--color-muted-foreground)]">{t("intro")}</p>
      </header>

      <section aria-labelledby="articles-heading" className="space-y-3">
        <h2 id="articles-heading" className="text-xl font-semibold tracking-tight">
          {t("articles.title")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label={t("articles.classifiedLabel")} value={stats.articles.classified} />
          <Stat
            label={t("articles.last7dLabel")}
            value={stats.articles.classifiedLast7d}
            tone="accent"
          />
        </div>
      </section>

      <section aria-labelledby="catalog-heading" className="space-y-3">
        <h2 id="catalog-heading" className="text-xl font-semibold tracking-tight">
          {t("catalog.title")}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label={t("catalog.sourcesLabel")} value={stats.sources.active} />
          <Stat label={t("catalog.categoriesLabel")} value={stats.categories.total} />
        </div>
      </section>

      <section aria-labelledby="tokens-heading" className="space-y-3">
        <h2 id="tokens-heading" className="text-xl font-semibold tracking-tight">
          {t("tokens.title")}
        </h2>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">{t("tokens.body")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label={t("tokens.last30dLabel")} value={stats.tokens.last30dTotal} tone="muted" />
        </div>
      </section>

      <section aria-labelledby="activity-heading" className="space-y-3">
        <h2 id="activity-heading" className="text-xl font-semibold tracking-tight">
          {t("activity.title")}
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Pair label={t("activity.lastIngestLabel")} value={formatTs(stats.lastIngestAt, locale, neverLabel)} />
          <Pair
            label={t("activity.lastClassifyLabel")}
            value={formatTs(stats.lastClassifyAt, locale, neverLabel)}
          />
        </dl>
      </section>

      <section aria-labelledby="api-heading" className="space-y-3 border-t border-[color:var(--color-border)] pt-8">
        <h2 id="api-heading" className="text-xl font-semibold tracking-tight">
          {t("api.title")}
        </h2>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">
          {t.rich("api.body", {
            link: (chunks) => (
              // The link points at the JSON API route, not a page — `next/link`
              // doesn't apply (and would warn at runtime). The lint rule that
              // assumes any `/api/...` href is a page link is the false
              // positive here.
              // eslint-disable-next-line @next/next/no-html-link-for-pages
              <a
                href="/api/stats"
                className="rounded font-medium text-[color:var(--color-foreground)] underline-offset-4 transition hover:text-[color:var(--color-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
        <p className="text-xs text-[color:var(--color-muted-foreground)]/80">
          {t("api.generatedAt", { ts: formatTs(stats.generatedAt, locale, neverLabel) })}
        </p>
      </section>
    </article>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "accent" | "muted";
}) {
  const accentClass =
    tone === "accent"
      ? "text-[color:var(--color-accent)]"
      : tone === "muted"
        ? "text-[color:var(--color-muted-foreground)]"
        : "text-[color:var(--color-foreground)]";
  return (
    <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
      <div className="text-xs uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
        {label}
      </div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${accentClass}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
      <dt className="text-xs uppercase tracking-wide text-[color:var(--color-muted-foreground)]">
        {label}
      </dt>
      <dd className="mt-1 text-base font-medium tabular-nums text-[color:var(--color-foreground)]">
        {value}
      </dd>
    </div>
  );
}

function formatTs(ts: string | null, locale: Locale, fallback: string): string {
  if (!ts) return fallback;
  const d = new Date(ts);
  return new Intl.DateTimeFormat(locale === "es" ? "es-ES" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(d);
}
