import type { NextConfig } from "next"

/**
 * Image hosts: the Medusa file storage public URL(s) (e.g. the OCI bucket
 * URL) — comma-separated URL prefixes in MEDUSA_IMAGE_HOSTS.
 */
const imageHosts = (process.env.MEDUSA_IMAGE_HOSTS || "http://localhost:9000/static/")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    remotePatterns: imageHosts.map((h) => new URL(h.endsWith("/") ? `${h}**` : `${h}/**`)),
    formats: ["image/avif", "image/webp"],
    // Local dev only (Medusa local file provider on localhost).
    dangerouslyAllowLocalIP: process.env.NODE_ENV !== "production" || process.env.IMAGES_ALLOW_LOCAL_IP === "true",
    unoptimized: process.env.NEXT_IMAGE_UNOPTIMIZED === "true",
    minimumCacheTTL: 60 * 60 * 24 * 7,
  },
  async redirects() {
    // Old Shopify URLs → new routes (301). Product and collection URLs keep
    // the same /products/<handle> and /collections/<handle> paths.
    return [
      { source: "/collections/all", destination: "/catalog", permanent: true },
      { source: "/pages/contact", destination: "/contact", permanent: true },
      { source: "/policies/privacy-policy", destination: "/privacy", permanent: true },
      { source: "/policies/terms-of-service", destination: "/terms", permanent: true },
      { source: "/policies/shipping-policy", destination: "/shipping", permanent: true },
      { source: "/policies/refund-policy", destination: "/refunds", permanent: true },
      { source: "/account/login", destination: "/login", permanent: true },
      { source: "/account/register", destination: "/register", permanent: true },
      { source: "/collections/:c/products/:handle", destination: "/products/:handle", permanent: true },
      { source: "/blogs/news", destination: "/", permanent: false },
    ]
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://api.razorpay.com\")" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ]
  },
}

export default nextConfig
