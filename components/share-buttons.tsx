"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

interface Props {
  /** Absolute URL of the article (NOT the kernelia.dev permalink — we want
   *  shares to point at the source so the original publisher gets credit). */
  url: string;
  /** Article title, used as the subject / status text in share intents. */
  title: string;
}

/**
 * Per-card share controls. Three buttons:
 *
 * 1. **Copy link** — `navigator.clipboard.writeText(url)`. Visual "Copied!"
 *    feedback for 1500ms. The clipboard API is HTTPS-only in practice;
 *    `document.execCommand('copy')` fallback is omitted on purpose because
 *    kernelia.dev is always served over HTTPS in production.
 * 2. **Mailto** — opens the user's email client. We use the article title
 *    as the subject and the URL as the body so the recipient sees both.
 * 3. **Mastodon** — opens `https://mastodon.social/share?text=…&url=…` in
 *    a new tab. Mastodon clients honour this intent and let the user pick
 *    their own instance to post from. No proprietary networks (Twitter,
 *    Meta) on purpose — they don't align with the project's posture.
 *
 * Sits ABOVE the card's stretched-link via `relative z-10 pointer-events-auto`
 * so clicks don't fall through to the title's `after:absolute inset-0`
 * overlay (which makes the whole card act as a link to the article).
 */
export function ShareButtons({ url, title }: Props) {
  const t = useTranslations("share");
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // `clipboard.writeText` can reject on permission denied or in
      // insecure contexts. We swallow silently — the user can still
      // copy via the URL bar of the opened article.
    }
  }

  // Mastodon share-intent: hits mastodon.social's share endpoint, which
  // detects the user's preferred instance and routes there. The site IS
  // hardcoded but the user's choice of instance is preserved by the
  // protocol.
  const mastodonIntent = `https://mastodon.social/share?text=${encodeURIComponent(
    title,
  )}&url=${encodeURIComponent(url)}`;

  const mailtoHref = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}`;

  return (
    <div
      className="relative z-10 mt-1 flex items-center gap-1.5"
      onClick={(e) => {
        // Defensive: prevent the card-wide stretched link from intercepting
        // these clicks even if the z-index dance fails for any reason.
        e.stopPropagation();
      }}
    >
      <IconButton
        type="button"
        onClick={copyLink}
        ariaLabel={copied ? t("copied") : t("copy")}
        title={copied ? t("copied") : t("copy")}
        tone={copied ? "active" : "default"}
      >
        {copied ? <CheckIcon /> : <LinkIcon />}
      </IconButton>
      <IconButtonLink
        href={mailtoHref}
        ariaLabel={t("email")}
        title={t("email")}
      >
        <MailIcon />
      </IconButtonLink>
      <IconButtonLink
        href={mastodonIntent}
        target="_blank"
        rel="noopener noreferrer"
        ariaLabel={t("mastodon")}
        title={t("mastodon")}
      >
        <MastodonIcon />
      </IconButtonLink>
    </div>
  );
}

// --- Local primitives ----------------------------------------------------
// Kept inline so this file is self-contained — the rest of the app uses
// shadcn primitives elsewhere, but a card-level micro-button doesn't
// warrant pulling in another component.

interface IconButtonBaseProps {
  ariaLabel: string;
  title: string;
  children: React.ReactNode;
}

interface IconButtonProps extends IconButtonBaseProps {
  type: "button";
  onClick: () => void;
  tone?: "default" | "active";
}

function IconButton({ ariaLabel, title, children, onClick, tone }: IconButtonProps) {
  const toneClass =
    tone === "active"
      ? "border-[color:var(--color-accent)]/40 text-[color:var(--color-accent)]"
      : "border-transparent text-[color:var(--color-muted-foreground)] hover:text-[color:var(--color-foreground)]";
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={title}
      onClick={onClick}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-md border bg-transparent transition-colors hover:bg-[color:var(--color-surface-2)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40 ${toneClass}`}
    >
      {children}
    </button>
  );
}

interface IconButtonLinkProps extends IconButtonBaseProps {
  href: string;
  target?: string;
  rel?: string;
}

function IconButtonLink({ href, target, rel, ariaLabel, title, children }: IconButtonLinkProps) {
  return (
    <a
      href={href}
      target={target}
      rel={rel}
      aria-label={ariaLabel}
      title={title}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent bg-transparent text-[color:var(--color-muted-foreground)] transition-colors hover:bg-[color:var(--color-surface-2)] hover:text-[color:var(--color-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
    >
      {children}
    </a>
  );
}

// --- Icons ---------------------------------------------------------------
// Tiny inline SVGs to avoid pulling more lucide-react glyphs into the
// public bundle for one usage site each. Stroke-based so they take
// `currentColor`.

function LinkIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
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
  );
}

function MastodonIcon() {
  // Simplified Mastodon glyph (M shape), traced from the official mark
  // and reduced to stroke-only so it inherits text color.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M21.58 13.913c-.29 1.469-2.592 3.121-5.238 3.435-1.379.164-2.737.314-4.185.247-2.368-.108-4.236-.563-4.236-.563 0 .231.014.45.043.656.307 2.332 2.314 2.471 4.215 2.536 1.92.066 3.629-.473 3.629-.473l.079 1.741s-1.343.72-3.74.853c-1.321.072-2.961-.033-4.872-.539C2.107 20.708.392 16.291.131 11.81-.001 9.493-.041 7.31.039 5.49.302 1.04 3.214.103 6.288.103c5.077 0 6.93.103 9.42.103 5.026 0 7.95 1.547 8.292 5.42.094 1.067.115 2.158.115 3.273 0 1.83-.181 3.502-.535 5.014z" />
    </svg>
  );
}
