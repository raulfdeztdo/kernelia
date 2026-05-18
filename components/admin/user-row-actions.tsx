"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Props {
  userId: string;
  email: string;
  active: boolean;
  /** True when this row is the currently-authenticated admin. UI hides
   *  destructive controls; the server enforces the same rule via the
   *  `self_target` guard in `db/queries/admin-users.ts`. */
  isSelf: boolean;
}

/**
 * Per-row controls for `/admin/users`:
 * - "Desactivar" / "Reactivar": PATCH `/api/admin/users/[id]` with `{active}`.
 * - "Borrar": DELETE same path.
 *
 * The error envelope follows the `{ error: code }` contract used elsewhere
 * in the admin surface. We translate known codes to Spanish copy so the
 * operator gets actionable feedback inline:
 *
 * - `would_orphan`: refusing because it would leave zero active admins.
 *   Recovery: reactivate / promote another user first.
 * - `self_target`: shouldn't happen because we hide the buttons, but we
 *   render it anyway so a malicious / scripted call gets a useful error.
 * - `duplicate_email`, `invalid_email`: live on the add form, not here.
 */
const ERROR_COPY: Record<string, string> = {
  would_orphan:
    "Esta acción dejaría el sistema sin ningún admin activo. Reactiva o añade otro admin primero.",
  self_target: "No puedes hacerlo sobre tu propio usuario.",
  not_found: "El usuario ya no existe (recarga la página).",
  unauthorized: "Sesión expirada. Vuelve a iniciar sesión.",
  forbidden: "No tienes permisos.",
};

export function UserRowActions({ userId, email, active, isSelf }: Props) {
  const { refresh } = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function mutate(method: "PATCH" | "DELETE", body?: unknown): Promise<void> {
    setError(null);
    const res = await fetch(`/api/admin/users/${userId}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      const code = payload.error ?? "";
      setError(ERROR_COPY[code] ?? `Error (${res.status}).`);
      return;
    }
    startTransition(() => refresh());
  }

  if (isSelf) {
    return <span className="text-xs text-muted-foreground">— tú mismo —</span>;
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            void mutate("PATCH", { active: !active });
          }}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-2 disabled:opacity-50"
        >
          {active ? "Desactivar" : "Reactivar"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (!confirm(`¿Borrar definitivamente al usuario ${email}? Esta acción no se puede deshacer.`)) {
              return;
            }
            void mutate("DELETE");
          }}
          className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
        >
          Borrar
        </button>
        {pending ? <span className="text-xs text-muted-foreground">guardando…</span> : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
