import "server-only"

/** Server-side configuration. Only NEXT_PUBLIC_* values ever reach the browser. */
function required(name: string, fallback?: string): string {
  const v = process.env[name]?.trim() || fallback
  if (!v) throw new Error(`Missing required environment variable ${name}`)
  return v
}

export const config = {
  /** Internal URL the Next server uses to reach Medusa (e.g. http://127.0.0.1:9000). */
  medusaInternalUrl: () => required("MEDUSA_BACKEND_URL", "http://127.0.0.1:9000").replace(/\/$/, ""),
  publishableKey: () => required("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY"),
  siteUrl: () => required("NEXT_PUBLIC_SITE_URL", "http://localhost:3000").replace(/\/$/, ""),
  regionCountry: () => (process.env.STORE_COUNTRY_CODE || "in").toLowerCase(),
  revalidateSeconds: () => Math.max(Number(process.env.CATALOG_REVALIDATE_SECONDS ?? 30) || 30, 0),
  noindex: () => process.env.SITE_NOINDEX === "true",
  revalidateSecret: () => process.env.REVALIDATE_SECRET || "",
}
