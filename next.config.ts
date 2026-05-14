import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Promoted out of `experimental` in Next 15.5.
  typedRoutes: true,
  // Article images come from arbitrary HTTPS publisher CDNs (TechCrunch,
  // HuggingFace, etc.) — enumerating every host is fragile, and we
  // already trust them as the link target. Allow any HTTPS origin so
  // `next/image` can optimise and lazy-load them. The optimisation
  // proxy strips Set-Cookie, prevents SVG XSS, and resizes to fit
  // device viewports.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default withNextIntl(nextConfig);
