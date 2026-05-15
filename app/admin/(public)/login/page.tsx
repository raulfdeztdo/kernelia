import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Acceso · Kernelia Admin",
};

const ERROR_COPY: Record<string, string> = {
  expired: "Ese enlace ha caducado. Pide uno nuevo.",
  invalid: "Enlace no válido. Pide uno nuevo.",
  used: "Ese enlace ya se usó. Pide uno nuevo.",
  revoked: "Tu cuenta ya no tiene acceso. Contacta al administrador.",
  rate_limited: "Demasiados intentos. Espera unos minutos y prueba otra vez.",
};

const SUCCESS_COPY = "Si ese email tiene acceso, recibirás un enlace en breve.";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AdminLoginPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const errorKey = typeof sp.error === "string" ? sp.error : undefined;
  const errorMessage = errorKey ? ERROR_COPY[errorKey] : undefined;
  const sent = sp.sent === "1";

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-surface p-6 shadow-lg">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Kernelia · Admin</h1>
          <p className="text-sm text-muted-foreground">
            Introduce tu email. Te enviaremos un enlace de acceso al inbox.
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

        <form action="/api/admin/magic-link" method="post" className="space-y-3">
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

        <p className="text-xs text-muted-foreground">
          El enlace caduca en 15 minutos y solo puede usarse una vez.
        </p>
      </div>
    </main>
  );
}
