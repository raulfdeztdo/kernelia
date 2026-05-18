"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const ERROR_COPY: Record<string, string> = {
  invalid_email: "Email no válido.",
  invalid_body: "Formulario incompleto.",
  duplicate_email: "Ya existe un usuario con ese email.",
  unauthorized: "Sesión expirada. Vuelve a iniciar sesión.",
  forbidden: "No tienes permisos.",
};

/**
 * Inline form to add a new admin user. POSTs to `/api/admin/users` and on
 * success clears the input and asks the server component to re-render via
 * `router.refresh()` so the new row shows up immediately. Errors render
 * below the input — no toast, no banner shift.
 */
export function AddUserForm() {
  const { refresh } = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        const code = payload.error ?? "";
        setError(ERROR_COPY[code] ?? `Error (${res.status}).`);
        return;
      }
      setEmail("");
      startTransition(() => refresh());
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-1">
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs">
          <span className="block uppercase tracking-wide text-muted-foreground">
            Añadir admin (email)
          </span>
          <input
            type="email"
            required
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="alguien@kernelia.dev"
            className="min-w-[260px] rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          />
        </label>
        <button
          type="submit"
          disabled={submitting || pending || email.trim() === ""}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Añadiendo…" : "Añadir"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
