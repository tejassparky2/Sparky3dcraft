/**
 * Shopify public storefront JSON source (no credentials needed):
 *   /products.json, /collections.json, /collections/<handle>/products.json
 *
 * Limitations (documented in docs/MIGRATION.md):
 *  - only products/collections PUBLISHED to the Online Store are visible
 *  - no inventory quantities (only `available`), no image alt text,
 *    no SEO title/description, no customers, no orders
 */
import type {
  NormalizedCollection,
  NormalizedImage,
  NormalizedProduct,
  NormalizedVariant,
  SourceSnapshot,
} from "../types"
import { gidToId, pickMp4 } from "../types"
import type { NormalizedVideo } from "../types"
import { fetchWithRetry, redact, sleep } from "./http"

type Opts = { storeUrl: string; fetchImpl?: typeof fetch; pageDelayMs?: number }

async function getJson(url: string, opts: Opts): Promise<any> {
  const res = await fetchWithRetry(url, { headers: { Accept: "application/json" } }, { fetchImpl: opts.fetchImpl })
  if (!res.ok) throw new Error(`GET ${redact(url)} -> HTTP ${res.status}`)
  return res.json()
}

async function paginate(base: string, key: string, opts: Opts): Promise<any[]> {
  const out: any[] = []
  for (let page = 1; page <= 200; page++) {
    const sep = base.includes("?") ? "&" : "?"
    const json = await getJson(`${base}${sep}limit=250&page=${page}`, opts)
    const items = json?.[key] ?? []
    out.push(...items)
    if (items.length < 250) break
    await sleep(opts.pageDelayMs ?? 300)
  }
  return out
}

export function normalizePublicProduct(p: any): NormalizedProduct {
  const images: NormalizedImage[] = (p.images ?? []).map((img: any, i: number) => ({
    source_id: gidToId(img.id),
    src: String(img.src),
    alt: img.alt ?? null,
    position: img.position ?? i + 1,
    width: img.width ?? null,
    height: img.height ?? null,
  }))
  const optionNames: string[] = (p.options ?? []).map((o: any) => String(o.name))
  const variants: NormalizedVariant[] = (p.variants ?? []).map((v: any, i: number) => {
    const option_values: Record<string, string> = {}
    optionNames.forEach((name, idx) => {
      const val = v[`option${idx + 1}`]
      if (val !== null && val !== undefined) option_values[name] = String(val)
    })
    return {
      source_id: gidToId(v.id),
      title: String(v.title ?? "Default Title"),
      sku: v.sku ? String(v.sku) : null,
      barcode: v.barcode ? String(v.barcode) : null,
      price: String(v.price),
      compare_at_price: v.compare_at_price ? String(v.compare_at_price) : null,
      grams: typeof v.grams === "number" ? v.grams : null,
      requires_shipping: v.requires_shipping !== false,
      taxable: v.taxable !== false,
      available: v.available !== false,
      inventory_quantity: null,
      inventory_tracked: null,
      allow_backorder: false,
      option_values,
      image_source_id: gidToId(v.featured_image?.id ?? null),
      position: v.position ?? i + 1,
    }
  })
  return {
    source_id: gidToId(p.id),
    handle: String(p.handle),
    title: String(p.title),
    description_html: String(p.body_html ?? ""),
    status: "published",
    product_type: p.product_type ? String(p.product_type) : null,
    vendor: p.vendor ? String(p.vendor) : null,
    tags: Array.isArray(p.tags)
      ? p.tags.map(String)
      : String(p.tags ?? "")
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
    options: (p.options ?? []).map((o: any) => ({ name: String(o.name), values: (o.values ?? []).map(String) })),
    variants,
    images,
    videos: [],
    seo_title: null,
    seo_description: null,
    created_at: p.created_at ?? null,
    updated_at: p.updated_at ?? null,
    published_at: p.published_at ?? null,
  }
}

export async function fetchPublicSnapshot(opts: Opts): Promise<SourceSnapshot> {
  const base = opts.storeUrl.replace(/\/$/, "")
  const warnings: string[] = [
    "public-json source: only Online-Store-published products are visible; inventory quantities, image alt text, SEO fields, customers and orders are NOT available",
  ]
  const rawProducts = await paginate(`${base}/products.json`, "products", opts)
  const products = rawProducts.map(normalizePublicProduct)
  // products.json omits videos; /products/<handle>.js lists all media.
  for (const p of products) {
    try {
      const js = await getJson(`${base}/products/${encodeURIComponent(p.handle)}.js`, opts)
      p.videos = videosFromProductJs(js)
    } catch (e) {
      warnings.push(`${p.handle}: could not read media list (${(e as Error).message}); videos not imported`)
    }
    await sleep(opts.pageDelayMs ?? 300)
  }

  const rawCollections = await paginate(`${base}/collections.json`, "collections", opts)
  const collections: NormalizedCollection[] = []
  for (const c of rawCollections) {
    const members = await paginate(`${base}/collections/${encodeURIComponent(c.handle)}/products.json`, "products", opts)
    collections.push({
      source_id: gidToId(c.id),
      handle: String(c.handle),
      title: String(c.title),
      description_html: String(c.description ?? c.body_html ?? ""),
      image_src: c.image?.src ?? null,
      image_alt: c.image?.alt ?? null,
      product_source_ids: members.map((m: any) => gidToId(m.id)).filter(Boolean) as string[],
      product_handles: members.map((m: any) => String(m.handle)),
      sort_order: c.sort_order ?? null,
      updated_at: c.updated_at ?? null,
      published: true,
    })
    await sleep(opts.pageDelayMs ?? 300)
  }
  return {
    kind: "shopify-public",
    fetched_at: new Date().toISOString(),
    shop: base,
    products,
    collections,
    warnings,
  }
}

export function videosFromProductJs(js: any): NormalizedVideo[] {
  const out: NormalizedVideo[] = []
  for (const m of js?.media ?? []) {
    if (m?.media_type !== "video") continue
    const src = pickMp4(
      (m.sources ?? []).map((s: any) => ({ mime: s.mime_type, url: s.url, width: s.width, height: s.height }))
    )
    if (!src) continue
    out.push({
      source_id: gidToId(m.id),
      src: src.url,
      mime: "video/mp4",
      width: src.width ?? null,
      height: src.height ?? null,
      position: m.position ?? out.length + 1,
      poster_src: m.preview_image?.src ?? null,
      alt: m.alt ?? null,
    })
  }
  return out
}
