import { getTranslations } from "next-intl/server";
import { getTelegramChannel } from "@/lib/broadcast-channels";
import { TelegramIcon, brandColor } from "@/components/social-icons";
import type { Locale } from "@/i18n/routing";

/**
 * "No te pierdas lo importante" block: Telegram + newsletter, side by side.
 * Server component (reads the channel from env). Used at the end of every
 * article page, where a reader who liked one summary is most likely to
 * want the next ones.
 *
 * Both links carry `data-track` so `/admin/analytics` can tell these CTAs
 * apart from the home ones.
 */
export async function FollowCta({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "article.follow" });
  const telegram = getTelegramChannel();
  const subscribeHref = locale === "es" ? "/about#subscribe" : `/${locale}/about#subscribe`;

  return (
    <aside
      aria-labelledby="follow-heading"
      className="relative overflow-hidden rounded-xl border border-[color:var(--color-accent)]/20 bg-gradient-to-br from-[color:var(--color-accent)]/10 via-[color:var(--color-surface)] to-[color:var(--color-surface)] px-5 py-5"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-6 -right-6 size-36 rounded-full bg-[color:var(--color-accent)]/15 blur-3xl"
      />
      <div className="relative space-y-3">
        <div>
          <h2 id="follow-heading" className="text-base font-semibold">
            {t("title")}
          </h2>
          <p className="mt-0.5 text-sm text-[color:var(--color-muted-foreground)]">{t("body")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {telegram && (
            <a
              href={telegram.url}
              target="_blank"
              rel="noopener noreferrer"
              data-track="cta:article-telegram"
              style={{ "--brand": brandColor("telegram") } as React.CSSProperties}
              className="inline-flex items-center gap-2 rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--brand)]/50 focus-visible:outline-none"
            >
              <TelegramIcon className="size-4" />
              {t("telegram")}
            </a>
          )}
          <a
            href={subscribeHref}
            data-track="cta:article-newsletter"
            className="inline-flex items-center gap-2 rounded-full border border-[color:var(--color-accent)]/30 bg-[color:var(--color-accent)]/10 px-4 py-2 text-sm font-medium text-[color:var(--color-accent)] transition hover:bg-[color:var(--color-accent)]/20 focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40 focus-visible:outline-none"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <rect width="20" height="16" x="2" y="4" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
            {t("newsletter")}
          </a>
        </div>
      </div>
    </aside>
  );
}
