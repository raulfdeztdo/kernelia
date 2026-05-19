"use client";

// The `header.tsx` call-site wraps this component in `<Suspense>` as
// `useSearchParams` requires, and the two `searchParams.get(...)` calls
// below cannot be destructured because `URLSearchParams.prototype.get`
// needs its `this` binding. Both lints would just add noise.
/* eslint-disable react-review/nextjs-no-use-search-params-without-suspense, react-review/react-compiler-destructure-method */

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface SearchBoxProps {
  placeholder: string;
  ariaLabel: string;
}

export function SearchBox({ placeholder, ariaLabel }: SearchBoxProps) {
  const { replace } = useRouter();
  const pathname = usePathname();
  // Note: not destructuring `get` here even though the lint suggests it —
  // `URLSearchParams.prototype.get` is bound to its instance, so
  // `const { get } = searchParams; get("q")` throws. The destructure
  // idiom from React Review only applies to object-literal returns
  // like `useRouter()`'s methods.
  const searchParams = useSearchParams();
  const initial = searchParams.get("q") ?? "";
  const [value, setValue] = useState(initial);
  const [, startTransition] = useTransition();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedRef = useRef(initial);

  // Stay in sync when the URL changes externally (e.g. clear filters).
  useEffect(() => {
    const fromUrl = searchParams.get("q") ?? "";
    if (fromUrl !== lastPushedRef.current) {
      setValue(fromUrl);
      lastPushedRef.current = fromUrl;
    }
  }, [searchParams]);

  function commit(next: string) {
    if (next === lastPushedRef.current) return;
    lastPushedRef.current = next;
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim().length === 0) {
      params.delete("q");
    } else {
      params.set("q", next.trim());
    }
    params.delete("cursor");
    const qs = params.toString();
    startTransition(() => {
      replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function onChange(next: string) {
    setValue(next);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => commit(next), 350);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (timerRef.current) clearTimeout(timerRef.current);
    commit(value);
  }

  return (
    <form role="search" onSubmit={onSubmit} className="relative w-full">
      <span
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[color:var(--color-muted-foreground)]"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="w-full rounded-full border border-[color:var(--color-border)] bg-[color:var(--color-surface)] py-2 pl-10 pr-4 text-sm outline-none placeholder:text-[color:var(--color-muted-foreground)] focus:border-[color:var(--color-accent)] focus:ring-2 focus:ring-[color:var(--color-accent)]/30"
      />
    </form>
  );
}
