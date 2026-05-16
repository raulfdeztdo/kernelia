import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Restablecer contraseña · Kernelia Admin",
};

const ERROR_COPY: Record<string, string> = {
  rate_limited: "Demasiados intentos. Espera unos minutos y prueba otra vez.",
};

const SUCCESS_COPY =
  "Si ese email está registrado, recibirás un enlace para restablecer la contraseña en unos minutos.";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/admin/forgot-password` — bootstraps a new password (for users who never
 * set one) or recovers a forgotten one. The endpoint always responds with
 * the same "if that email is registered…" copy, so this surface never
 * reveals whether the email exists.
 *
 * This is also the documented onboarding path: an admin adds a user via
 * `/admin/users`, the new user lands here, asks for a link, and sets their
 * password via `/admin/reset-password`. No invitation email is sent
 * directly — the user pulls the link themselves.
 */
export default async function ForgotPasswordPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const errorKey = typeof sp.error === "string" ? sp.error : undefined;
  const errorMessage = errorKey ? ERROR_COPY[errorKey] : undefined;
  const sent = sp.sent === "1";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-surface p-6 shadow-lg">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Restablecer contraseña</h1>
          <p className="text-sm text-muted-foreground">
            Te enviaremos un enlace de un solo uso para elegir una nueva contraseña.
          </p>
        </header>

        {sent ? (
          <div
            role="status"
            className="rounded-md border border-accent/40 bg-accent/10 p-3 text-sm text-foreground"
          >
            {SUCCESS_COPY}
          </div>
        ) : null}

        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-foreground"
          >
            {errorMessage}
          </div>
        ) : null}

        <form action="/api/admin/forgot-password" method="post" className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              placeholder="tu@email.com"
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-border-strong"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            Enviarme enlace
          </button>
        </form>

        <p className="text-center text-sm">
          <Link href="/admin/login" className="text-accent underline-offset-2 hover:underline">
            ← Volver al login
          </Link>
        </p>

        <p className="text-xs text-muted-foreground">
          El enlace caduca en 30 minutos y solo puede usarse una vez. Después de cambiar la
          contraseña, todas las sesiones activas se cerrarán.
        </p>
      </div>
    </main>
  );
}
