import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { SESSION_COOKIE_NAME, getUserBySessionCookie } from "@/lib/auth/sessions";

/**
 * Guard for every private route in `/admin/*`. Server-rendered so the cookie
 * check happens before any HTML reaches the browser. If the session is
 * missing or invalid, redirect to `/admin/login`; if the user was deactivated
 * mid-session, redirect with `?error=revoked`.
 *
 * Public routes (the login page and the auth callback) live under
 * `app/admin/(public)/*` and `app/admin/auth/*` respectively, so they don't
 * inherit this layout.
 */
export default async function AdminPrivateLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const result = await getUserBySessionCookie(cookie);

  if (!result) {
    if (cookie) {
      // We had a cookie but it didn't resolve to a valid + active user.
      // Most often: user was deactivated. Tell them, don't loop silently.
      redirect("/admin/login?error=revoked");
    }
    redirect("/admin/login");
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border bg-surface/60 backdrop-blur">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-baseline gap-3">
            <span className="text-base font-semibold">Kernelia · Admin</span>
            <span className="text-xs text-muted-foreground">{result.user.email}</span>
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
      <main className="container mx-auto flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
