import type { MetadataRoute } from "next"
import { siteUrl } from "@/lib/seo"

export default function robots(): MetadataRoute.Robots {
  if (process.env.SITE_NOINDEX === "true") {
    // staging: keep everything out of search engines
    return { rules: [{ userAgent: "*", disallow: "/" }] }
  }
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // Mirrors the live Shopify rules for private and crawl-trap URLs.
        disallow: ["/cart", "/checkout", "/account", "/order/", "/api/", "/search", "/reset-password", "/forgot-password", "/*?*sort=", "/*?*availability="],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  }
}
