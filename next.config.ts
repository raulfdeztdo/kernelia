import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Promoted out of `experimental` in Next 15.5.
  typedRoutes: true,
};

export default withNextIntl(nextConfig);
