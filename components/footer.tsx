import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getAllPublicChannels } from "@/lib/broadcast-channels";
import { GitHubIcon, platformIcon } from "@/components/social-icons";

function FooterLink({ href, label }: { href: "/about" | "/stats"; label: string }) {
  return (
    <Link
      href={href}
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
           * Small brand-mark to the left of the author credit. The same
           * logo appears larger on the /about page. Decorative — the
           * adjacent author link names the brand for screen readers, so
           * `alt=""`.
           */}
          <Image
            src="/kernelia-logo.jpg"
            alt=""
            width={28}
            height={28}
            className="size-7 shrink-0 rounded-md"
            priority={false}
          />
          {/*
           * Author credit replaces the old "Construido con…" tagline.
           * Same target as the project's source-code link further to the
           * right, but this one points at the *profile*, not the repo —
           * a small but meaningful distinction so the operator stays the
           * face of the project without leaning on social media.
           */}
          <a
            href="https://github.com/raulfdeztdo"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded font-medium text-[color:var(--color-foreground)]/85 transition hover:text-[color:var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
          >
            <span>raulfdeztdo</span>
            <GitHubIcon className="size-3.5" />
          </a>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FooterLink href="/about" label={t("about")} />
          <FooterLink href="/stats" label={t("stats")} />
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
                  // The icon is the visible cue; the platform name reaches
                  // assistive tech via aria-label, and hovering shows the
                  // full handle so the user knows which account it is.
                  aria-label={c.platform}
                  title={c.handle}
                  className="inline-flex size-7 items-center justify-center rounded-md text-[color:var(--color-muted-foreground)] transition hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
                >
                  {platformIcon(c.platform, "size-4")}
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
