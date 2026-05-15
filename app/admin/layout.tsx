import type { Metadata } from "next";
import type { ReactNode } from "react";
import "../globals.css";

/**
 * Admin shell layout. Provides `<html>/<body>` (the root layout is a thin
 * pass-through and `app/[locale]/layout.tsx` is locale-only) and forces
 * `noindex, nofollow` so search engines never include the backoffice.
 *
 * No `NextIntlClientProvider` here on purpose — the admin surface is ES-only,
 * copy is inlined. If we ever need EN copy for admins, this is where to wire
 * a provider with its own messages namespace.
 */
export const metadata: Metadata = {
  title: "Kernelia · Admin",
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
