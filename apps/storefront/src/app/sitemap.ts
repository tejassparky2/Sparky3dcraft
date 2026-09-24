import type { MetadataRoute } from "next"
import { listCategories, listProducts } from "@/lib/data/catalog"
import { siteUrl } from "@/lib/seo"

export const revalidate = 300

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl()
  const [products, categories] = await Promise.all([listProducts(), listCategories()])
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/catalog`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.3 },
    ...categories.map((c) => ({ url: `${base}/collections/${c.handle}`, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...products.map((p) => ({
      url: `${base}/products/${p.handle}`,
      lastModified: p.updated_at ? new Date(String(p.updated_at)) : undefined,
      changeFrequency: "weekly" as const,
      priority: 0.9,
      images: p.images?.map((i) => i.url).slice(0, 10),
    })),
  ]
}
