import type { ReactNode } from "react";

// Root layout required by Next.js App Router. The locale-aware layout
// lives at app/[locale]/layout.tsx and provides <html>/<body>.
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
