import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  PASSWORD_RESET_TTL_MS,
  PasswordResetVerificationError,
  verifyPasswordResetToken,
} from "@/lib/auth/password-reset";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/passwords";

export const metadata: Metadata = {
  title: "Elegir nueva contraseña · Kernelia Admin",
};

const ERROR_COPY: Record<string, string> = {
  too_short: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  invalid_password: "Contraseña no válida.",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/admin/reset-password?token=...` — final step of the bootstrap / recovery
 * flow. We verify the token server-side BEFORE rendering the form: an
 * invalid / expired / consumed token kicks the user to `/admin/login` with
 * an explanation, so they don't waste keystrokes on a dead link.
 *
 * Verification here is read-only (`verifyPasswordResetToken`). The token is
 * actually consumed atomically by the POST handler when the user submits the
 * new password — that way a stale tab open for ~30min still works if the
 * underlying token is fine, and a race between two tabs is decided by the
 * UPDATE narrowed on `used_at IS NULL`.
 */
export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const errorKey = typeof sp.error === "string" ? sp.error : undefined;
  const errorMessage = errorKey ? ERROR_COPY[errorKey] : undefined;

  if (!token) {
    redirect("/admin/login?error=invalid_reset");
  }

  // `redirect()` throws a special Next-internal error to perform the
  // navigation, so calling it inside a try/catch lets the catch swallow
  // it. We compute the redirect target outside the try and only call
  // `redirect` after the try block exits cleanly.
  let redirectTo: string | null = null;
  try {
    await verifyPasswordResetToken(token);
  } catch (err) {
    if (err instanceof PasswordResetVerificationError) {
      redirectTo = `/admin/login?error=${encodeURIComponent(err.reason)}`;
    } else {
      throw err;
    }
  }
  if (redirectTo) redirect(redirectTo);

  const ttlMinutes = Math.round(PASSWORD_RESET_TTL_MS / 60_000);

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm space-y-6 rounded-lg border bg-surface p-6 shadow-lg">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Elegir nueva contraseña</h1>
          <p className="text-sm text-muted-foreground">
            Mínimo {PASSWORD_MIN_LENGTH} caracteres. Tras guardar, te pediremos volver a iniciar
            sesión.
          </p>
        </header>

        {errorMessage ? (
          <div
            role="alert"
            className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-foreground"
          >
            {errorMessage}
          </div>
        ) : null}

        <form action="/api/admin/reset-password" method="post" className="space-y-3">
          <input type="hidden" name="token" value={token} />
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">Nueva contraseña</span>
            <input
              type="password"
              name="password"
              autoComplete="new-password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              className="block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-border-strong"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            Guardar contraseña
          </button>
        </form>

        <p className="text-center text-sm">
          <Link href="/admin/login" className="text-accent underline-offset-2 hover:underline">
            ← Volver al login
          </Link>
        </p>

        <p className="text-xs text-muted-foreground">
          El enlace caduca en {ttlMinutes} minutos.
        </p>
      </div>
    </main>
  );
}
