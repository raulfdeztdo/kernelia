import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getAllPublicChannels } from "@/lib/broadcast-channels";

function AboutLink({ label }: { label: string }) {
  return (
    <Link
      href="/about"
      className="rounded transition hover:text-[color:var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
    >
      {label}
    </Link>
  );
}

export async function Footer() {
  const t = await getTranslations("footer");
  const year = new Date().getFullYear();
  // Resolved server-side from the same env vars that drive the broadcaster
  // bot, so the "Síguenos en…" links can never point at an inactive
  // channel.
  const channels = getAllPublicChannels();

  return (
    <footer className="mt-16 border-t border-[color:var(--color-border)]">
      <div className="container mx-auto flex flex-col gap-4 px-4 py-8 text-sm text-[color:var(--color-muted-foreground)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {/*
           * Small brand-mark to the left of the tagline. The same logo
           * appears larger on the /about page. Decorative — the wordmark
           * in the header already covers the brand role for screen
           * readers, so this image is `alt=""`.
           */}
          <Image
            src="/kernelia-logo.jpg"
            alt=""
            width={28}
            height={28}
            className="size-7 shrink-0 rounded-md"
            priority={false}
          />
          <span>{t("tagline")}</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <AboutLink label={t("about")} />
          <a
            href="https://github.com/raulfdeztdo/kernelia"
            target="_blank"
            rel="noreferrer"
            className="rounded transition hover:text-[color:var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
          >
            {t("source")}
          </a>
          {channels.length > 0 ? (
            <span className="flex items-center gap-2">
              <span className="text-[color:var(--color-muted-foreground)]/70">·</span>
              {channels.map((c) => (
                <a
                  key={c.platform}
                  href={c.url}
                  target="_blank"
                  rel="noreferrer"
                  title={c.handle}
                  className="rounded capitalize transition hover:text-[color:var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
                >
                  {c.platform}
                </a>
              ))}
            </span>
          ) : null}
          <span>{t("rights", { year })}</span>
        </nav>
      </div>
    </footer>
  );
}
