"use client";

import { useTranslations } from "next-intl";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { CATEGORY_SLUGS, type CategorySlug } from "@/lib/categories";
import { cn } from "@/lib/utils";

interface CategoryFilterProps {
  selected: CategorySlug[];
  facets: Record<string, number>;
}

export function CategoryFilter({ selected, facets }: CategoryFilterProps) {
  const t = useTranslations("categories");
  const tHome = useTranslations("home");
  const { replace } = useRouter();
  const pathname = usePathname();
  // The call-site in `app/[locale]/page.tsx` already wraps this component
  // in `<Suspense>` (required for `useSearchParams` not to bail the route
  // to client-side rendering), so the lint here is a false positive.
  // eslint-disable-next-line react-review/nextjs-no-use-search-params-without-suspense
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function push(nextCats: CategorySlug[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextCats.length === 0) {
      params.delete("category");
    } else {
      params.set("category", nextCats.join(","));
    }
    params.delete("cursor");
    const qs = params.toString();
    startTransition(() => {
      replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function toggle(slug: CategorySlug) {
    if (selected.includes(slug)) {
      push(selected.filter((s) => s !== slug));
    } else {
      push([...selected, slug]);
    }
  }

  return (
    <div
      className="-mx-4 overflow-x-auto px-4"
      role="group"
      aria-label={tHome("filterCategoriesAria")}
    >
      <div className="flex min-w-min gap-2">
        <button
          type="button"
          onClick={() => push([])}
          aria-pressed={selected.length === 0}
          className={cn(
            "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium uppercase tracking-wider transition",
            selected.length === 0
              ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent)] text-[color:var(--color-accent-foreground)]"
              : "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-foreground)]",
          )}
        >
          {tHome("allCategories")}
        </button>
        {CATEGORY_SLUGS.map((slug) => {
          const active = selected.includes(slug);
          const count = facets[slug] ?? 0;
          return (
            <button
              key={slug}
              type="button"
              onClick={() => toggle(slug)}
              aria-pressed={active}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium uppercase tracking-wider transition",
                active
                  ? "border-transparent text-[color:var(--color-background)]"
                  : "border-[color:var(--color-border)] text-[color:var(--color-muted-foreground)] hover:border-[color:var(--color-border-strong)] hover:text-[color:var(--color-foreground)]",
              )}
              style={
                active ? { background: `var(--color-cat-${slug})` } : undefined
              }
            >
              <span>{t(slug)}</span>
              {count > 0 && (
                <span
                  className={cn(
                    "ml-1.5 text-[10px] opacity-80",
                    active ? "" : "text-[color:var(--color-muted-foreground)]",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
