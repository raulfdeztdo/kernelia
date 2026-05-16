import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SESSION_COOKIE_NAME, getUserBySessionCookie } from "@/lib/auth/sessions";
import { AdminSidebar } from "@/components/admin/sidebar";

/**
 * Guard for every private route in `/admin/*`. Server-rendered so the cookie
 * check happens before any HTML reaches the browser. If the session is
 * missing or invalid, redirect to `/admin/login`; if the user was deactivated
 * mid-session, redirect with `?error=revoked`.
 *
 * Public routes (the login page, forgot-password and reset-password) live
 * under `app/admin/(public)/*` so they don't inherit this layout.
 *
 * Layout shape (Phase 7.G):
 *   - Sticky header: brand + signed-in email + logout (full width).
 *   - Below the header: flex row with a left-column sidebar (`/admin`,
 *     `/admin/articles`, `/admin/users`, `/admin/cron`) and the main area.
 *   - On mobile (< md), the sidebar collapses to a horizontal scroll-strip
 *     above the main content, keeping every section reachable without a
 *     hamburger menu.
 */
export default async function AdminPrivateLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const result = await getUserBySessionCookie(cookie);

  if (!result) {
    if (cookie) {
      redirect("/admin/login?error=revoked");
    }
    redirect("/admin/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-surface/80 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-base font-semibold">Kernelia · Admin</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {result.user.email}
            </span>
          </div>
          <form action="/api/admin/logout" method="post">
            <button
              type="submit"
              className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface-2"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </header>

      <div className="container mx-auto flex flex-1 flex-col px-4 md:flex-row md:gap-6 md:px-4">
        <AdminSidebar />
        <main className="flex-1 py-6 md:py-8">{children}</main>
      </div>
    </div>
  );
}
