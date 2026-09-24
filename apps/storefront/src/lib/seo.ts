import type { Metadata } from "next"
import { site } from "./site"

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "")

/** Title pattern of the live site: "{page} – SPARKY 3D CRAFT CO". */
export function pageMetadata(opts: {
  title: string
  description?: string | null
  path: string
  image?: string | null
  type?: "website" | "article"
  noindex?: boolean
}): Metadata {
  const url = `${siteUrl()}${opts.path}`
  const description = opts.description?.slice(0, 300) || undefined
  const images = [opts.image || `${siteUrl()}/brand/og-default.jpg`]
  return {
    title: opts.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: `${opts.title} – ${site.name}`,
      description,
      url,
      siteName: site.name,
      type: opts.type ?? "website",
      images,
      locale: "en_IN",
    },
    twitter: { card: "summary_large_image", title: `${opts.title} – ${site.name}`, description, images },
    ...(opts.noindex ? { robots: { index: false, follow: true } } : {}),
  }
}

export function stripHtml(html: string | null | undefined): string {
  return String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
}

/** Serialize JSON-LD safely inside a <script> tag. */
export function jsonLd(data: unknown): { __html: string } {
  return { __html: JSON.stringify(data).replace(/</g, "\\u003c") }
}
