"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import type { ArticleStatus } from "@/db/schema";

const STATUS_LABEL: Record<ArticleStatus, string> = {
  pending: "Pending",
  classified: "Classified",
  failed: "Failed",
  hidden: "Hidden",
};

interface CategoryOption {
  id: string;
  slug: string;
  nameEs: string;
}

interface Props {
  articleId: string;
  currentStatus: ArticleStatus;
  currentCategoryId: string | null;
  /** When false, switching to `classified` will hit the 422 guard. */
  canBeClassified: boolean;
  categories: CategoryOption[];
}

/**
 * Per-row action island. Three controls:
 * - Status dropdown: POST to `/api/admin/articles/[id]/status`.
 * - Category dropdown: POST to `/api/admin/articles/[id]/category`.
 * - "Re-classify" button: POST to `/api/admin/articles/[id]/reclassify`.
 *
 * Each control runs through `runMutation`, which optimistically disables
 * the row, fetches, parses the standard `{error,...}` envelope, and on
 * success calls `router.refresh()` so the server component re-fetches the
 * row. On the `missing_columns` 422, it displays the offending fields
 * inline without reloading the page.
 */
export function ArticleRowActions({
  articleId,
  currentStatus,
  currentCategoryId,
  canBeClassified,
  categories,
}: Props) {
  const { refresh } = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function runMutation(path: string, body: unknown): Promise<void> {
    setError(null);
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 422) {
      const payload = (await res.json().catch(() => ({}))) as {
        error?: string;
        missingColumns?: string[];
      };
      if (payload.error === "missing_columns") {
        setError(`Faltan columnas: ${(payload.missingColumns ?? []).join(", ")}`);
        return;
      }
      setError(payload.error ?? "Acción rechazada (422).");
      return;
    }
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? `Error HTTP ${res.status}.`);
      return;
    }
    startTransition(() => refresh());
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`status-${articleId}`}>
          Cambiar status
        </label>
        <select
          id={`status-${articleId}`}
          disabled={pending}
          defaultValue={currentStatus}
          onChange={(e) => {
            const next = e.target.value as ArticleStatus;
            if (next === currentStatus) return;
            if (next === "classified" && !canBeClassified) {
              setError(
                "Este artículo no tiene todas las columnas requeridas (categoría + título ES/EN + resumen ES/EN). Re-clasifica primero.",
              );
              e.target.value = currentStatus;
              return;
            }
            void runMutation(`/api/admin/articles/${articleId}/status`, { status: next });
          }}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
        >
          {(Object.keys(STATUS_LABEL) as ArticleStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>

        <label className="sr-only" htmlFor={`cat-${articleId}`}>
          Reasignar categoría
        </label>
        <select
          id={`cat-${articleId}`}
          disabled={pending}
          defaultValue={currentCategoryId ?? ""}
          onChange={(e) => {
            const raw = e.target.value;
            const next = raw === "" ? null : raw;
            if (next === currentCategoryId) return;
            void runMutation(`/api/admin/articles/${articleId}/category`, { categoryId: next });
          }}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs disabled:opacity-50"
        >
          <option value="">(sin categoría)</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nameEs}
            </option>
          ))}
        </select>

        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (
              !confirm(
                "¿Volver a clasificar este artículo? Se marcará como pending y el próximo cron lo procesará.",
              )
            )
              return;
            void runMutation(`/api/admin/articles/${articleId}/reclassify`, {});
          }}
          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-2 disabled:opacity-50"
        >
          Re-clasificar
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
