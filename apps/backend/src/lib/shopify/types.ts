/**
 * Source-agnostic representation of Shopify data. All three sources
 * (Admin GraphQL API, public storefront JSON, product CSV export) are
 * normalized into these shapes before anything touches Medusa.
 *
 * `source_id` is the numeric Shopify ID as a string. The Admin API GID
 * `gid://shopify/Product/123` and the public JSON `id: 123` normalize to the
 * same "123", so API and public-JSON imports share one identity space.
 * CSV exports carry no IDs: CSV rows get `source_id: null` and are matched by
 * handle (unique in Medusa) — see docs/MIGRATION.md.
 */

export type SourceKind = "shopify-admin" | "shopify-public" | "shopify-csv"

export type NormalizedImage = {
  source_id: string | null
  src: string
  alt: string | null
  position: number
  width?: number | null
  height?: number | null
}

export type NormalizedVideo = {
  source_id: string | null
  /** MP4 rendition chosen for web playback (<= 720p when available). */
  src: string
  mime: string
  width: number | null
  height: number | null
  position: number
  poster_src: string | null
  alt: string | null
}

export type NormalizedVariant = {
  source_id: string | null
  title: string
  sku: string | null
  barcode: string | null
  price: string // decimal string, major units
  compare_at_price: string | null
  grams: number | null
  requires_shipping: boolean
  taxable: boolean
  available: boolean
  /** Only known from the Admin API / CSV. null = unknown. */
  inventory_quantity: number | null
  inventory_tracked: boolean | null
  allow_backorder: boolean
  option_values: Record<string, string>
  image_source_id: string | null
  position: number
}

export type NormalizedProduct = {
  source_id: string | null
  handle: string
  title: string
  description_html: string
  status: "published" | "draft"
  product_type: string | null
  vendor: string | null
  tags: string[]
  options: { name: string; values: string[] }[]
  variants: NormalizedVariant[]
  images: NormalizedImage[]
  videos: NormalizedVideo[]
  seo_title: string | null
  seo_description: string | null
  created_at: string | null
  updated_at: string | null
  published_at: string | null
}

export type NormalizedCollection = {
  source_id: string | null
  handle: string
  title: string
  description_html: string
  image_src: string | null
  image_alt: string | null
  product_source_ids: string[]
  product_handles: string[]
  sort_order: string | null
  updated_at: string | null
  published: boolean
}

export type NormalizedAddress = {
  first_name: string | null
  last_name: string | null
  company: string | null
  address_1: string | null
  address_2: string | null
  city: string | null
  province: string | null
  postal_code: string | null
  country_code: string | null
  phone: string | null
}

export type NormalizedCustomer = {
  source_id: string
  email: string | null
  first_name: string | null
  last_name: string | null
  phone: string | null
  accepts_marketing: boolean
  addresses: (NormalizedAddress & { is_default: boolean })[]
  created_at: string | null
  updated_at: string | null
  tags: string[]
  note: string | null
}

export type NormalizedOrderLine = {
  source_id: string
  title: string
  variant_title: string | null
  sku: string | null
  quantity: number
  unit_price: string // price paid per unit, major units, before order-level discounts
  product_source_id: string | null
  variant_source_id: string | null
  requires_shipping: boolean
}

export type NormalizedOrder = {
  source_id: string
  name: string // "#1001"
  order_number: number | null
  email: string | null
  customer_source_id: string | null
  currency_code: string
  created_at: string
  processed_at: string | null
  cancelled_at: string | null
  financial_status: string | null
  fulfillment_status: string | null
  subtotal: string | null
  total_tax: string | null
  total_shipping: string | null
  total_discounts: string | null
  total: string
  taxes_included: boolean
  shipping_address: NormalizedAddress | null
  billing_address: NormalizedAddress | null
  shipping_lines: { title: string; price: string }[]
  lines: NormalizedOrderLine[]
  note: string | null
  tags: string[]
}

export type SourceSnapshot = {
  kind: SourceKind
  fetched_at: string
  shop: string
  products: NormalizedProduct[]
  collections: NormalizedCollection[]
  customers?: NormalizedCustomer[]
  orders?: NormalizedOrder[]
  warnings: string[]
}

export function gidToId(gid: string | number | null | undefined): string | null {
  if (gid === null || gid === undefined || gid === "") return null
  const s = String(gid)
  const m = /\/(\d+)(?:\?.*)?$/.exec(s)
  if (m) return m[1]
  return /^\d+$/.test(s) ? s : null
}

/** Pick the MP4 rendition closest to 720p (never above 1080p). */
export function pickMp4<T extends { mime: string; url: string; width?: number | null; height?: number | null }>(
  sources: T[]
): T | null {
  const mp4 = sources.filter((s) => s.mime === "video/mp4" && s.url)
  if (!mp4.length) return null
  const score = (s: T) => Math.abs(Math.min(s.width ?? 0, s.height ?? 0) - 720)
  return [...mp4].sort((a, b) => score(a) - score(b))[0]
}
