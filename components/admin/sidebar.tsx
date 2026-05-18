"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface AdminNavItem {
  href: string;
  label: string;
  /** Optional emoji/glyph rendered as a leading mark. */
  glyph: string;
  /**
   * Whether this entry should be considered "active" only on the exact
   * path. Defaults to true for `/admin` (we don't want it lit for every
   * sub-route). Other entries match prefixes so `/admin/articles?status=…`
   * still highlights the Articles tab.
   */
  exact?: boolean;
}

export const ADMIN_NAV_ITEMS: readonly AdminNavItem[] = [
  { href: "/admin", label: "Panel", glyph: "▤", exact: true },
  { href: "/admin/articles", label: "Artículos", glyph: "◫" },
  { href: "/admin/broadcasts", label: "Broadcasts", glyph: "◈" },
  { href: "/admin/users", label: "Usuarios", glyph: "◉" },
  { href: "/admin/cron", label: "Cron", glyph: "◔" },
];

/**
 * Pure decision: does `pathname` (Next's `usePathname`, which excludes the
 * query string) match this nav entry? Extracted from the component so it
 * can be unit-tested without rendering.
 *
 * Rule: `exact` entries match only on equality; everything else also matches
 * sub-paths under the entry's `href`. That keeps `/admin/articles?status=…`
 * (whose pathname is `/admin/articles`) and `/admin/articles/[id]` (if we
 * ever add one) both lit on the Articles tab — while `/admin/users` does
 * NOT light up the `/admin` Panel entry.
 */
export function isNavItemActive(item: AdminNavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * Sidebar navigation for the admin backoffice. Client component because we
 * need `usePathname` for the active-link highlight; the rest of the layout
 * stays server. Bundle cost is negligible — only `<Link>` and a string
 * comparison.
 *
 * On mobile (< md) we collapse to a horizontal scroll-strip above the main
 * content. The desktop layout pins the nav as a left column.
 */
export function AdminSidebar(): ReactNode {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Navegación del admin"
      className="md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:w-48 md:shrink-0 md:border-r md:border-border md:bg-surface/40"
    >
      <ul className="flex gap-1 overflow-x-auto px-3 py-2 md:flex-col md:gap-0.5 md:overflow-visible md:px-3 md:py-4">
        {ADMIN_NAV_ITEMS.map((item) => {
          const active = isNavItemActive(item, pathname);
          return (
            <li key={item.href} className="md:w-full">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={
                  "flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors " +
                  (active
                    ? "bg-accent/15 font-medium text-accent"
                    : "text-muted-foreground hover:bg-surface-2 hover:text-foreground")
                }
              >
                <span aria-hidden className="text-xs opacity-70">
                  {item.glyph}
                </span>
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
