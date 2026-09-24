import "server-only"
import type { HttpTypes } from "@medusajs/types"
import { cache } from "react"
import { config } from "../config"
import { CATALOG_TAG, medusa } from "../medusa"
import { meta, ms } from "@/lib/meta"

export type Product = HttpTypes.StoreProduct
export type Category = HttpTypes.StoreProductCategory & { products?: { id: string }[] }

const catalogFetch = () => ({
  next: { revalidate: config.revalidateSeconds(), tags: [CATALOG_TAG] },
})

export const PRODUCT_FIELDS = [
  "*variants.calculated_price",
  "+variants.inventory_quantity",
  "+metadata",
].join(",")

/** The single selling region (India). Resolved by country, cached. */
export const getRegion = cache(async (): Promise<HttpTypes.StoreRegion> => {
  const { regions } = await medusa().client.fetch<{ regions: HttpTypes.StoreRegion[] }>("/store/regions", {
    query: { fields: "id,name,currency_code,*countries" },
    ...catalogFetch(),
  })
  const cc = config.regionCountry()
  const region = regions.find((r) => r.countries?.some((c) => c.iso_2 === cc)) ?? regions[0]
  if (!region) throw new Error("No region configured in Medusa (run setup-store)")
  return region
})

export async function listProducts(opts: {
  categoryId?: string
  q?: string
  limit?: number
  ids?: string[]
} = {}): Promise<Product[]> {
  const region = await getRegion()
  const query: Record<string, unknown> = {
    region_id: region.id,
    fields: PRODUCT_FIELDS,
    limit: opts.limit ?? 200,
    order: "-created_at",
  }
  if (opts.categoryId) query.category_id = [opts.categoryId]
  if (opts.q) query.q = opts.q
  if (opts.ids) query.id = opts.ids
  const { products } = await medusa().client.fetch<{ products: Product[] }>("/store/products", {
    query,
    ...(opts.q ? { cache: "no-store" as const } : catalogFetch()),
  })
  return products
}

export const getProductByHandle = cache(async (handle: string): Promise<Product | null> => {
  const region = await getRegion()
  const { products } = await medusa().client.fetch<{ products: Product[] }>("/store/products", {
    query: { handle, region_id: region.id, fields: PRODUCT_FIELDS, limit: 1 },
    ...catalogFetch(),
  })
  return products[0] ?? null
})

/** Categories (Shopify "collections") with member product ids. */
export const listCategories = cache(async (): Promise<Category[]> => {
  const { product_categories } = await medusa().client.fetch<{ product_categories: Category[] }>(
    "/store/product-categories",
    {
      query: { fields: "id,name,handle,description,metadata,rank,products.id", limit: 200 },
      ...catalogFetch(),
    }
  )
  return product_categories
})

export async function getCategoryByHandle(handle: string): Promise<Category | null> {
  return (await listCategories()).find((c) => c.handle === handle) ?? null
}

export async function categoriesForProduct(productId: string): Promise<Category[]> {
  return (await listCategories()).filter((c) => c.products?.some((p) => p.id === productId))
}

// ---------------------------------------------------------------- helpers

export type PriceInfo = {
  amount: number
  original: number
  currency: string
  onSale: boolean
}

export function variantPrice(v: HttpTypes.StoreProductVariant | undefined): PriceInfo | null {
  const cp = v?.calculated_price
  if (!cp || cp.calculated_amount === null || cp.calculated_amount === undefined) return null
  const amount = Number(cp.calculated_amount)
  const original = Number(cp.original_amount ?? amount)
  return { amount, original, currency: cp.currency_code ?? "inr", onSale: original > amount }
}

/** Cheapest variant price for cards. */
export function productPrice(p: Product): PriceInfo | null {
  const prices = (p.variants ?? []).map(variantPrice).filter(Boolean) as PriceInfo[]
  if (!prices.length) return null
  return prices.sort((a, b) => a.amount - b.amount)[0]
}

export function variantInStock(v: HttpTypes.StoreProductVariant): boolean {
  if (!v.manage_inventory || v.allow_backorder) return true
  return (v.inventory_quantity ?? 0) > 0
}

export function productInStock(p: Product): boolean {
  return (p.variants ?? []).some(variantInStock)
}

export type SortKey = "featured" | "title-ascending" | "title-descending" | "price-ascending" | "price-descending" | "created-ascending" | "created-descending"

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "featured", label: "Featured" },
  { value: "title-ascending", label: "Alphabetically, A-Z" },
  { value: "title-descending", label: "Alphabetically, Z-A" },
  { value: "price-ascending", label: "Price, low to high" },
  { value: "price-descending", label: "Price, high to low" },
  { value: "created-ascending", label: "Date, old to new" },
  { value: "created-descending", label: "Date, new to old" },
]

/**
 * "Featured" = the collection's manual order, stored as a comma-separated
 * list of product handles in category metadata `product_order` (imported
 * from Shopify's manual collection order; editable in Admin). Unlisted
 * products follow, newest first.
 */
export function featuredOrder(products: Product[], orderCsv: string | undefined): Product[] {
  const order = (orderCsv ?? "").split(",").map((h) => h.trim()).filter(Boolean)
  const rank = (p: Product) => {
    const i = order.indexOf(p.handle)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...products].sort((a, b) => rank(a) - rank(b))
}

export function sortProducts(products: Product[], sort: SortKey): Product[] {
  const arr = [...products]
  const price = (p: Product) => productPrice(p)?.amount ?? Number.MAX_SAFE_INTEGER
  const created = (p: Product) => new Date(String(ms(p, "shopify_created_at") ?? p.created_at ?? 0)).getTime()
  switch (sort) {
    case "title-ascending":
      return arr.sort((a, b) => a.title.localeCompare(b.title))
    case "title-descending":
      return arr.sort((a, b) => b.title.localeCompare(a.title))
    case "price-ascending":
      return arr.sort((a, b) => price(a) - price(b))
    case "price-descending":
      return arr.sort((a, b) => price(b) - price(a))
    case "created-ascending":
      return arr.sort((a, b) => created(a) - created(b))
    case "created-descending":
      return arr.sort((a, b) => created(b) - created(a))
    default:
      return arr
  }
}

export type Filters = { availability?: "in" | "out"; min?: number; max?: number }

export function filterProducts(products: Product[], f: Filters): Product[] {
  return products.filter((p) => {
    if (f.availability === "in" && !productInStock(p)) return false
    if (f.availability === "out" && productInStock(p)) return false
    const pr = productPrice(p)?.amount
    if (f.min !== undefined && (pr === undefined || pr < f.min)) return false
    if (f.max !== undefined && (pr === undefined || pr > f.max)) return false
    return true
  })
}

export type MediaItem =
  | { kind: "image"; url: string; alt: string; key: string }
  | { kind: "video"; url: string; poster: string | null; alt: string; key: string; width: number | null; height: number | null }

/** Images (Medusa) + videos (metadata) interleaved by their original media position. */
type VideoMeta = { url: string; poster_url?: unknown; alt?: string; position?: number; width?: number | null; height?: number | null }

export function productMedia(p: Product): MediaItem[] {
  const images: MediaItem[] = [...(p.images ?? [])]
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
    .map((img) => ({
      kind: "image" as const,
      url: img.url,
      alt: String(ms(img, "alt") || p.title),
      key: img.id,
    }))
  const rawVideos = meta(p).videos
  const videos = (Array.isArray(rawVideos) ? (rawVideos as VideoMeta[]) : [])
    .filter((v) => typeof v?.url === "string" && /^https?:\/\//.test(v.url))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  const out = [...images]
  for (const v of videos) {
    const idx = Math.min(Math.max((Number(v.position) || out.length + 1) - 1, 0), out.length)
    out.splice(idx, 0, {
      kind: "video",
      url: v.url,
      poster: typeof v.poster_url === "string" ? v.poster_url : null,
      alt: v.alt || `${p.title} video`,
      key: v.url,
      width: v.width ?? null,
      height: v.height ?? null,
    })
  }
  return out
}
