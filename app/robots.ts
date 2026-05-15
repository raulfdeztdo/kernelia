import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  const origin = getSiteUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /admin is the backoffice (Fase 7). Layout also emits
        // `noindex,nofollow`, but disallow here keeps well-behaved
        // crawlers from fetching it at all.
        disallow: ["/api/", "/admin/"],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
