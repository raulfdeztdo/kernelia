import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Promoted out of `experimental` in Next 15.5.
  typedRoutes: true,
  // No `images.remotePatterns` on purpose. Article images are rendered
  // `unoptimized` straight from the publisher's CDN (see
  // `components/article-image.tsx`): the optimiser ran out of Hobby quota
  // and every uncached image turned into a 402. Allowing `**` here would
  // also leave `/_next/image` as an open proxy anyone could use to burn
  // that quota. Only local assets (`/kernelia-logo.jpg`) go through it now.
};

export default withNextIntl(nextConfig);
