"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";

interface Props {
  /** Resolved at render time on the server; passed through to the endpoint
   *  so the locale matches the page the visitor was on. */
  locale: "es" | "en";
}

/**
 * Newsletter signup. Client island wired to `POST /api/newsletter/subscribe`.
 *
 * Submits JSON via `fetch` so we can show inline success / rate-limit /
 * invalid-email messages instead of a full-page redirect. The endpoint
 * also accepts `application/x-www-form-urlencoded` so a no-JS visitor who
 * hits the form directly still works — but we don't expose that path here
 * (no `<form action>`) because the JS path is the one we test.
 *
 * Status uniformity: the API never tells us "this email already exists",
 * so success copy stays the same for first-subscribe vs re-arm. The
 * recipient finds out via the confirmation email.
 */
export function NewsletterForm({ locale }: Props) {
  const t = useTranslations("newsletter.form");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "invalid" | "rate" | "error">(
    "idle",
  );

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    try {
      const res = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, locale }),
      });
      if (res.ok) {
        setStatus("ok");
        setEmail("");
        return;
      }
      if (res.status === 429) {
        setStatus("rate");
        return;
      }
      if (res.status === 400) {
        setStatus("invalid");
        return;
      }
      setStatus("error");
    } catch {
      setStatus("error");
    }
  }

  const messageId = "newsletter-form-message";

  return (
    <form onSubmit={onSubmit} className="space-y-2" noValidate>
      <label htmlFor="newsletter-email" className="block text-sm font-medium">
        {t("label")}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="newsletter-email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("placeholder")}
          aria-describedby={status !== "idle" && status !== "loading" ? messageId : undefined}
          aria-invalid={status === "invalid" ? true : undefined}
          className="flex-1 rounded-md border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 py-2 text-sm placeholder:text-[color:var(--color-muted-foreground)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/40"
          disabled={status === "loading"}
        />
        <button
          type="submit"
          disabled={status === "loading" || email.length === 0}
          className="inline-flex items-center justify-center rounded-md bg-[color:var(--color-accent)] px-4 py-2 text-sm font-medium text-[color:var(--color-accent-foreground,white)] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)]/60 disabled:opacity-50"
        >
          {status === "loading" ? t("submitting") : t("submit")}
        </button>
      </div>
      {status === "ok" ? (
        <p
          id={messageId}
          role="status"
          className="text-sm text-[color:var(--color-accent)]"
        >
          {t("success")}
        </p>
      ) : null}
      {status === "invalid" ? (
        <p id={messageId} role="alert" className="text-sm text-amber-500">
          {t("invalid")}
        </p>
      ) : null}
      {status === "rate" ? (
        <p id={messageId} role="alert" className="text-sm text-amber-500">
          {t("rate")}
        </p>
      ) : null}
      {status === "error" ? (
        <p id={messageId} role="alert" className="text-sm text-red-500">
          {t("error")}
        </p>
      ) : null}
      <p className="text-xs text-[color:var(--color-muted-foreground)]/80">{t("hint")}</p>
    </form>
  );
}
