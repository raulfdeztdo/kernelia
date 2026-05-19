import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/routing";
import { listSourcesPublic } from "@/db/queries/sources";
import { CATEGORY_SLUGS } from "@/lib/categories";
import { getAllPublicChannels } from "@/lib/broadcast-channels";
import { platformIcon } from "@/components/social-icons";
import { NewsletterForm } from "@/components/newsletter-form";
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

const PLATFORM_LABEL: Record<"mastodon" | "bluesky" | "telegram", string> = {
  mastodon: "Mastodon",
  bluesky: "Bluesky",
  telegram: "Telegram",
};

export default async function AboutPage({ params }: AboutPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const [t, tCategories] = await Promise.all([
    getTranslations("about"),
    getTranslations("categories"),
  ]);

  let sources: { name: string; url: string }[] = [];
  try {
    sources = await listSourcesPublic();
  } catch {
    // Falls through to an empty sources list — still renders the rest.
  }

  // Channels are resolved from the same env vars the broadcaster bot uses
  // (MASTODON_INSTANCE_URL, BLUESKY_IDENTIFIER, TELEGRAM_CHAT_ID). Any
  // channel not configured is silently filtered out so the "Suscríbete"
  // block never shows broken links.
  const channels = getAllPublicChannels();

  return (
    <article className="mx-auto max-w-3xl space-y-10">
      <header className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
        {/*
         * Logo block. Decorative — the title next to it already names the
         * brand for screen readers, so `alt=""`. Designed and rendered by
         * the project owner; credit lives in the §credits section below.
         */}
        <Image
          src="/kernelia-logo.jpg"
          alt=""
          width={88}
          height={88}
          priority
          className="size-20 shrink-0 rounded-2xl shadow-sm"
        />
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t("title")}</h1>
          <p className="text-base text-[color:var(--color-muted-foreground)]">{t("intro")}</p>
        </div>
      </header>

      <section aria-labelledby="subscribe-heading" className="space-y-3">
        <h2 id="subscribe-heading" className="text-xl font-semibold tracking-tight">
          {t("subscribe.title")}
        </h2>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">
          {t("subscribe.body")}
        </p>
        <ul className="flex flex-wrap gap-2">
          {/*
           * RSS badges first: the longest-lived format and the only one
           * that requires zero account on a third-party. One per locale so
           * a Spanish reader gets a Spanish-titled feed. The targets are
           * Route Handlers that return `application/xml`, so we use
           * `<Link prefetch={false}>` to skip the wasted prefetch round-
           * trip while keeping the html-side anchor and accessibility.
           */}
          <li>
            <Link
              href="/rss.xml?lang=es"
              prefetch={false}
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5 text-xs font-medium transition hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
            >
              <RssIcon />
              RSS · ES
            </Link>
          </li>
          <li>
            <Link
              href="/rss.xml?lang=en"
              prefetch={false}
              className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5 text-xs font-medium transition hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
            >
              <RssIcon />
              RSS · EN
            </Link>
          </li>
          {channels.map((c) => (
            <li key={c.platform}>
              <a
                href={c.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-1.5 text-xs font-medium transition hover:border-[color:var(--color-border-strong)] hover:bg-[color:var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
              >
                {platformIcon(c.platform, "size-3.5 text-[color:var(--color-accent)]")}
                {PLATFORM_LABEL[c.platform]}
                <span className="text-[color:var(--color-muted-foreground)]/80">{c.handle}</span>
              </a>
            </li>
          ))}
        </ul>
        {/*
         * Newsletter signup. Sits below the RSS + social badges because
         * those are zero-friction (no account, no email left behind). The
         * newsletter is the highest-commitment channel of the section, so
         * it earns its own subsection with a heading.
         */}
        <div className="mt-6 rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] p-4">
          <h3 className="mb-2 text-base font-medium">{t("newsletter.title")}</h3>
          <p className="mb-3 text-sm text-[color:var(--color-muted-foreground)]">
            {t("newsletter.body")}
          </p>
          <NewsletterForm locale={locale} />
        </div>
      </section>

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
                className="mr-1.5 inline-block size-1.5 rounded-full align-middle"
                style={{ background: `var(--color-cat-${slug})` }}
              />
              {tCategories(slug)}
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-xl font-semibold tracking-tight">{t("sources.title")}</h2>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">{t("sources.body")}</p>
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

      <section aria-labelledby="credits-heading" className="space-y-3 border-t border-[color:var(--color-border)] pt-8">
        <h2 id="credits-heading" className="text-xl font-semibold tracking-tight">
          {t("credits.title")}
        </h2>
        <p className="text-sm text-[color:var(--color-muted-foreground)]">
          {t.rich("credits.body", {
            author: (chunks) => (
              <a
                href="https://github.com/raulfdeztdo"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded font-medium text-[color:var(--color-foreground)] underline-offset-4 transition hover:text-[color:var(--color-accent)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
              >
                {chunks}
              </a>
            ),
          })}
        </p>
      </section>
    </article>
  );
}

function RssIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[color:var(--color-accent)]"
      aria-hidden
    >
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1.5" />
    </svg>
  );
}
