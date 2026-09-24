/**
 * Idempotent, re-runnable Shopify → Medusa importer.
 *
 * Identity: sparky_source_mapping(source="shopify", entity_type, source_id)
 * is unique. Every entity is resolved in this order:
 *   1. mapping by Shopify ID            → update if source checksum changed
 *   2. existing Medusa row by handle/email → adopt (write mapping)
 *   3. create + write mapping
 * so a re-run never creates duplicates, and a CSV import (no IDs, handle
 * identity) cannot duplicate products created by an API import.
 *
 * Order of operations follows data dependencies:
 * tags/types → images → products+variants+prices → sale price list →
 * inventory levels → categories (Shopify collections) → customers → orders.
 */
import crypto from "node:crypto"
import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils"
import {
  batchPriceListPricesWorkflow,
  createCustomersWorkflow,
  createInventoryLevelsWorkflow,
  createPriceListsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createProductTagsWorkflow,
  createProductTypesWorkflow,
  updateInventoryLevelsWorkflow,
  updateProductCategoriesWorkflow,
  updateProductsWorkflow,
  uploadFilesWorkflow,
} from "@medusajs/medusa/core-flows"
import { SPARKY_MODULE } from "../../modules/sparky"
import type SparkyModuleService from "../../modules/sparky/service"
import type {
  NormalizedVideo,
  NormalizedCollection,
  NormalizedCustomer,
  NormalizedImage,
  NormalizedOrder,
  NormalizedProduct,
  SourceSnapshot,
} from "./types"
import { fetchWithRetry, redact } from "./sources/http"

export const MAPPING_SOURCE = "shopify"
/**
 * Bump when the Shopify→Medusa mapping logic changes: it is part of every
 * checksum, so the next run re-applies all entities with the new mapping.
 */
export const IMPORTER_MAPPING_VERSION = "3"
export const SALE_PRICE_LIST_TITLE = "Sale prices (Shopify compare-at)"

export type ImportMode = "dry-run" | "apply"
export type Entity = "products" | "collections" | "customers" | "orders"

export type ImportOptions = {
  mode: ImportMode
  entities: Entity[]
  force?: boolean
  /** Re-download and re-upload images even if already re-hosted (orphans old files). */
  forceImages?: boolean
  fetchImpl?: typeof fetch
  /** Max image size accepted from the source CDN. */
  maxImageBytes?: number
}

type Counter = { created: number; updated: number; unchanged: number; adopted: number; skipped: number; failed: number }
const counter = (): Counter => ({ created: 0, updated: 0, unchanged: 0, adopted: 0, skipped: 0, failed: 0 })

export type ImportReport = {
  source: SourceSnapshot["kind"]
  mode: ImportMode
  started_at: string
  finished_at?: string
  products: Counter
  images: { uploaded: number; reused: number; failed: number }
  sale_prices: { set: number; removed: number }
  inventory: { levels_created: number; levels_updated: number; unmanaged_unknown: number }
  categories: Counter
  customers: Counter
  orders: Counter
  warnings: string[]
  errors: string[]
}

export function checksum(v: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(v)).digest("hex")
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as any)[k])}`)
      .join(",")}}`
  }
  return JSON.stringify(v)
}

/** Decimal string → number in major units, rejecting garbage. */
export function money(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid money value "${v}"`)
  return Math.round(n * 100) / 100
}

/** Base (original) price and optional sale price from Shopify price/compare-at. */
export function priceModel(price: string, compareAt: string | null): { base: number; sale: number | null } {
  const p = money(price)!
  const c = money(compareAt)
  if (c !== null && c > p) return { base: c, sale: p }
  return { base: p, sale: null }
}

const IMAGE_MAGIC: [string, (b: Buffer) => boolean][] = [
  ["image/png", (b) => b.length > 8 && b.readUInt32BE(0) === 0x89504e47],
  ["image/jpeg", (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/gif", (b) => b.length > 6 && b.toString("ascii", 0, 3) === "GIF"],
  ["image/webp", (b) => b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP"],
  ["image/avif", (b) => b.length > 12 && b.toString("ascii", 4, 12).startsWith("ftypavi")],
]

export function sniffMp4(buf: Buffer): boolean {
  return buf.length > 12 && buf.toString("ascii", 4, 8) === "ftyp"
}

export function sniffImage(buf: Buffer): string | null {
  for (const [mime, test] of IMAGE_MAGIC) if (test(buf)) return mime
  return null
}

function imageKey(img: NormalizedImage): string {
  if (img.source_id) return img.source_id
  // CSV: no image IDs; key by the URL path (Shopify appends ?v=<ts>).
  const u = new URL(img.src)
  return "url:" + crypto.createHash("sha256").update(u.origin + u.pathname).digest("hex").slice(0, 32)
}

function filenameFor(img: NormalizedImage, handle: string, mime: string): string {
  const ext = mime.split("/")[1].replace("jpeg", "jpg")
  const base = handle.replace(/[^a-z0-9-]/gi, "-").slice(0, 60)
  return `products/${base}-${img.position}.${ext}`
}

export class ShopifyImporter {
  private readonly logger: any
  private readonly query: any
  private readonly sparky: SparkyModuleService
  private readonly report: ImportReport
  private ctx!: {
    salesChannelId: string
    locationId: string
    shippingProfileId: string
    currency: string
    regionId: string | null
  }
  private tagIds = new Map<string, string>()
  private typeIds = new Map<string, string>()
  /** Shopify product source id / handle → Medusa product id (filled during run). */
  private productTargets = new Map<string, string>()
  private variantTargets = new Map<string, string>()

  constructor(private readonly container: MedusaContainer, private readonly snapshot: SourceSnapshot, private readonly opts: ImportOptions) {
    this.logger = container.resolve(ContainerRegistrationKeys.LOGGER)
    this.query = container.resolve(ContainerRegistrationKeys.QUERY)
    this.sparky = container.resolve<SparkyModuleService>(SPARKY_MODULE)
    this.report = {
      source: snapshot.kind,
      mode: opts.mode,
      started_at: new Date().toISOString(),
      products: counter(),
      images: { uploaded: 0, reused: 0, failed: 0 },
      sale_prices: { set: 0, removed: 0 },
      inventory: { levels_created: 0, levels_updated: 0, unmanaged_unknown: 0 },
      categories: counter(),
      customers: counter(),
      orders: counter(),
      warnings: [...snapshot.warnings],
      errors: [],
    }
  }

  private get dry() {
    return this.opts.mode === "dry-run"
  }

  private log(msg: string) {
    this.logger.info(`[shopify-import] ${msg}`)
  }

  // ------------------------------------------------------------------ mapping

  private async findMapping(entity: string, sourceId: string) {
    const [m] = await this.sparky.listSourceMappings({ source: MAPPING_SOURCE, entity_type: entity, source_id: sourceId })
    return m ?? null
  }

  private async saveMapping(entity: string, sourceId: string, targetId: string, extra: { handle?: string | null; checksum?: string; updated_at?: string | null; metadata?: Record<string, unknown> }) {
    if (this.dry) return
    const existing = await this.findMapping(entity, sourceId)
    const data = {
      source_handle: extra.handle ?? null,
      target_id: targetId,
      checksum: extra.checksum ?? null,
      source_updated_at: extra.updated_at ? new Date(extra.updated_at) : null,
      metadata: extra.metadata ?? existing?.metadata ?? null,
    }
    if (existing) await this.sparky.updateSourceMappings({ id: existing.id, ...data })
    else await this.sparky.createSourceMappings({ source: MAPPING_SOURCE, entity_type: entity, source_id: sourceId, ...data })
  }

  /** Identity key for a product: Shopify id, or handle for CSV sources. */
  private productKey(p: NormalizedProduct) {
    return p.source_id ?? `handle:${p.handle}`
  }

  // ---------------------------------------------------------------- context

  private async loadContext() {
    const storeModule = this.container.resolve(Modules.STORE)
    const fulfillment = this.container.resolve(Modules.FULFILLMENT)
    const regionModule = this.container.resolve(Modules.REGION)
    const [store] = await storeModule.listStores({}, { relations: ["supported_currencies"] })
    if (!store?.default_sales_channel_id || !store.default_location_id) {
      throw new Error("Store is not set up. Run setup-store first (default sales channel and stock location required).")
    }
    const [profile] = await fulfillment.listShippingProfiles({ type: "default" })
    if (!profile) throw new Error("No default shipping profile. Run setup-store first.")
    const currency = (store.supported_currencies ?? []).find((c: any) => c.is_default)?.currency_code
    if (!currency) throw new Error("Store has no default currency. Run setup-store first.")
    const [region] = await regionModule.listRegions({ currency_code: currency })
    this.ctx = {
      salesChannelId: store.default_sales_channel_id,
      locationId: store.default_location_id,
      shippingProfileId: profile.id,
      currency,
      regionId: region?.id ?? null,
    }
    for (const p of this.snapshot.products) {
      for (const v of p.variants) {
        if (!v.price) throw new Error(`${p.handle}: variant without price`)
      }
    }
  }

  // ---------------------------------------------------------------- tags/types

  private async ensureTagsAndTypes(products: NormalizedProduct[]) {
    const productModule = this.container.resolve(Modules.PRODUCT)
    const wantedTags = [...new Set(products.flatMap((p) => p.tags))]
    if (wantedTags.length) {
      const existing = await productModule.listProductTags({ value: wantedTags }, { take: null as any })
      existing.forEach((t: any) => this.tagIds.set(t.value, t.id))
      const missing = wantedTags.filter((t) => !this.tagIds.has(t))
      if (missing.length && !this.dry) {
        const { result } = await createProductTagsWorkflow(this.container).run({
          input: { product_tags: missing.map((value) => ({ value })) },
        })
        result.forEach((t: any) => this.tagIds.set(t.value, t.id))
      }
    }
    const wantedTypes = [...new Set(products.map((p) => p.product_type).filter(Boolean) as string[])]
    if (wantedTypes.length) {
      const existing = await productModule.listProductTypes({ value: wantedTypes } as any)
      existing.forEach((t: any) => this.typeIds.set(t.value, t.id))
      const missing = wantedTypes.filter((t) => !this.typeIds.has(t))
      if (missing.length && !this.dry) {
        const { result } = await createProductTypesWorkflow(this.container).run({
          input: { product_types: missing.map((value) => ({ value })) },
        })
        result.forEach((t: any) => this.typeIds.set(t.value, t.id))
      }
    }
  }

  // ------------------------------------------------------------------- images

  /** Re-host an image in the Medusa File Module. Returns public URL. */
  private async ensureImage(img: NormalizedImage, handle: string): Promise<string | null> {
    const key = imageKey(img)
    const mapping = await this.findMapping("image", key)
    if (mapping && !this.opts.forceImages) {
      this.report.images.reused++
      return (mapping.metadata as any)?.url ?? null
    }
    if (this.dry) {
      this.report.images.uploaded++
      return `dry-run://${key}`
    }
    try {
      const max = this.opts.maxImageBytes ?? 20 * 1024 * 1024
      const res = await fetchWithRetry(img.src, {}, { fetchImpl: this.opts.fetchImpl, timeoutMs: 60000 })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const len = Number(res.headers.get("content-length") ?? 0)
      if (len > max) throw new Error(`image too large (${len} bytes)`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > max) throw new Error(`image too large (${buf.length} bytes)`)
      const mime = sniffImage(buf)
      if (!mime) throw new Error("downloaded file is not a recognised image format")
      const { result } = await uploadFilesWorkflow(this.container).run({
        input: {
          files: [{ filename: filenameFor(img, handle, mime), mimeType: mime, content: buf.toString("base64"), access: "public" }],
        },
      })
      const file = result[0]
      await this.saveMapping("image", key, file.id, {
        handle,
        metadata: { url: file.url, source_src: redact(img.src), bytes: buf.length, mime, width: img.width ?? null, height: img.height ?? null },
      })
      this.report.images.uploaded++
      return file.url
    } catch (e) {
      this.report.images.failed++
      this.report.errors.push(`image ${redact(img.src)} for ${handle}: ${(e as Error).message}`)
      return null
    }
  }

  /** Re-host a product video (MP4) in the File Module. */
  private async ensureVideo(v: NormalizedVideo, handle: string): Promise<Record<string, unknown> | null> {
    const key = v.source_id ?? "url:" + crypto.createHash("sha256").update(new URL(v.src).pathname).digest("hex").slice(0, 32)
    const mapping = await this.findMapping("video", key)
    const poster = v.poster_src
      ? await this.ensureImage({ source_id: null, src: v.poster_src, alt: v.alt, position: v.position }, `${handle}-video-poster`)
      : null
    const meta = (url: string) => ({ url, poster_url: poster, width: v.width, height: v.height, position: v.position, alt: v.alt, mime: "video/mp4" })
    if (mapping && !this.opts.forceImages) return meta((mapping.metadata as any)?.url)
    if (this.dry) return meta(`dry-run://${key}`)
    try {
      const max = 80 * 1024 * 1024
      const res = await fetchWithRetry(v.src, {}, { fetchImpl: this.opts.fetchImpl, timeoutMs: 120000 })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length > max) throw new Error(`video too large (${buf.length} bytes)`)
      if (!sniffMp4(buf)) throw new Error("downloaded file is not an MP4")
      const { result } = await uploadFilesWorkflow(this.container).run({
        input: { files: [{ filename: `products/${handle.slice(0, 60)}-video-${v.position}.mp4`, mimeType: "video/mp4", content: buf.toString("base64"), access: "public" }] },
      })
      await this.saveMapping("video", key, result[0].id, { handle, metadata: { url: result[0].url, source_src: redact(v.src), bytes: buf.length } })
      return meta(result[0].url)
    } catch (e) {
      this.report.errors.push(`video ${redact(v.src)} for ${handle}: ${(e as Error).message}`)
      return null
    }
  }

  // ------------------------------------------------------------------ products

  private productChecksum(p: NormalizedProduct) {
    return checksum({ v: IMPORTER_MAPPING_VERSION, ...p, created_at: undefined, updated_at: undefined })
  }

  private buildVariants(p: NormalizedProduct, existingVariants: Map<string, string>) {
    return p.variants.map((v) => {
      const { base } = priceModel(v.price, v.compare_at_price)
      const known = v.inventory_quantity !== null && v.inventory_tracked !== false
      const manage = known ? true : !v.available // unknown+available → unmanaged; unavailable → managed with 0
      const vKey = v.source_id ?? `${p.handle}:${v.sku ?? v.title}`
      const id = existingVariants.get(vKey)
      return {
        ...(id ? { id } : {}),
        title: v.title,
        sku: v.sku ?? undefined,
        barcode: v.barcode ?? undefined,
        manage_inventory: manage,
        allow_backorder: v.allow_backorder,
        weight: v.grams ?? undefined,
        options: Object.keys(v.option_values).length ? v.option_values : { Title: v.title },
        prices: [{ amount: base, currency_code: this.ctx.currency }],
        metadata: {
          shopify_variant_id: v.source_id,
          shopify_price: v.price,
          shopify_compare_at_price: v.compare_at_price,
          inventory_source: known ? "shopify" : v.available ? "unknown-public-source" : "unavailable-at-import",
          requires_shipping: v.requires_shipping,
          taxable: v.taxable,
        },
      }
    })
  }

  private async importProducts() {
    const products = this.snapshot.products
    await this.ensureTagsAndTypes(products)
    const productModule = this.container.resolve(Modules.PRODUCT)

    for (const p of products) {
      const key = this.productKey(p)
      try {
        const sum = this.productChecksum(p)
        const mapping = await this.findMapping("product", key)
        let targetId: string | null = mapping?.target_id ?? null
        let adopted = false
        if (targetId) {
          const [exists] = await productModule.listProducts({ id: targetId }, { withDeleted: false } as any)
          if (!exists) {
            this.report.products.skipped++
            this.report.warnings.push(`${p.handle}: mapped Medusa product ${targetId} was deleted in Medusa; not re-created`)
            continue
          }
        } else {
          const [byHandle] = await productModule.listProducts({ handle: p.handle })
          if (byHandle) {
            targetId = byHandle.id
            adopted = true
          }
        }

        if (targetId && !adopted && mapping?.checksum === sum && !this.opts.force) {
          this.productTargets.set(key, targetId)
          this.report.products.unchanged++
          await this.recordVariantTargets(p, targetId)
          continue
        }

        // images (re-hosted) ------------------------------------------------
        const urls: { url: string; alt: string }[] = []
        for (const img of [...p.images].sort((a, b) => a.position - b.position)) {
          const url = await this.ensureImage(img, p.handle)
          if (url) urls.push({ url, alt: img.alt || p.title })
        }
        const videos: Record<string, unknown>[] = []
        for (const v of p.videos ?? []) {
          const m = await this.ensureVideo(v, p.handle)
          if (m) videos.push(m)
        }
        if (p.images.length && !urls.length) {
          this.report.warnings.push(`${p.handle}: no images could be re-hosted`)
        }

        const base = {
          title: p.title,
          handle: p.handle,
          description: p.description_html,
          status: p.status === "published" ? ProductStatus.PUBLISHED : ProductStatus.DRAFT,
          thumbnail: urls[0]?.url,
          images: urls.map((u) => ({ url: u.url, metadata: { alt: u.alt } })),
          external_id: p.source_id ? `shopify:${p.source_id}` : undefined,
          tag_ids: p.tags.map((t) => this.tagIds.get(t)).filter(Boolean) as string[],
          type_id: p.product_type ? this.typeIds.get(p.product_type) : undefined,
          weight: p.variants[0]?.grams ?? undefined,
          discountable: true,
          sales_channels: [{ id: this.ctx.salesChannelId }],
          shipping_profile_id: this.ctx.shippingProfileId,
          metadata: {
            migrated_from: "shopify",
            shopify_product_id: p.source_id,
            shopify_vendor: p.vendor,
            seo_title: p.seo_title,
            seo_description: p.seo_description,
            shopify_published_at: p.published_at,
            shopify_created_at: p.created_at,
            videos,
          },
        }

        if (this.dry) {
          if (!targetId) this.report.products.created++
          else if (adopted) this.report.products.adopted++
          else this.report.products.updated++
          continue
        }

        if (!targetId) {
          const { result } = await createProductsWorkflow(this.container).run({
            input: {
              products: [
                {
                  ...base,
                  options: p.options.map((o) => ({ title: o.name, values: o.values })),
                  variants: this.buildVariants(p, new Map()) as any,
                },
              ],
            },
          })
          targetId = result[0].id
          this.report.products.created++
        } else {
          const existingVariants = await this.existingVariantKeys(p, targetId)
          // Merge metadata so keys set in Admin (e.g. personalization_*) survive re-imports.
          const [current] = await productModule.listProducts({ id: targetId }, { select: ["id", "metadata"] })
          base.metadata = { ...((current?.metadata as Record<string, unknown>) ?? {}), ...base.metadata }
          await updateProductsWorkflow(this.container).run({
            input: {
              products: [
                {
                  id: targetId,
                  ...base,
                  // Options are reconciled only when variant structure changes;
                  // single "Title" option products are the common case.
                  variants: this.buildVariants(p, existingVariants) as any,
                } as any,
              ],
            },
          })
          if (adopted) this.report.products.adopted++
          else this.report.products.updated++
        }
        this.productTargets.set(key, targetId)
        await this.saveMapping("product", key, targetId, { handle: p.handle, checksum: sum, updated_at: p.updated_at })
        await this.recordVariantTargets(p, targetId, true)
      } catch (e) {
        this.report.products.failed++
        this.report.errors.push(`product ${p.handle}: ${(e as Error).message}`)
      }
    }
  }

  private async existingVariantKeys(p: NormalizedProduct, productId: string): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    const { data } = await this.query.graph({
      entity: "product_variant",
      fields: ["id", "sku", "title", "metadata"],
      filters: { product_id: productId },
    })
    for (const v of data as any[]) {
      const sid = v.metadata?.shopify_variant_id
      if (sid) map.set(String(sid), v.id)
      map.set(`${p.handle}:${v.sku ?? v.title}`, v.id)
    }
    return map
  }

  private async recordVariantTargets(p: NormalizedProduct, productId: string, writeMappings = false) {
    const existing = await this.existingVariantKeys(p, productId)
    for (const v of p.variants) {
      const vKey = v.source_id ?? `${p.handle}:${v.sku ?? v.title}`
      const id = existing.get(vKey)
      if (!id) continue
      this.variantTargets.set(vKey, id)
      if (writeMappings && v.source_id) {
        await this.saveMapping("variant", v.source_id, id, { handle: p.handle })
      }
    }
  }

  // ------------------------------------------------------------- sale prices

  private async syncSalePrices() {
    if (this.dry) {
      for (const p of this.snapshot.products) for (const v of p.variants) if (priceModel(v.price, v.compare_at_price).sale !== null) this.report.sale_prices.set++
      return
    }
    const pricing = this.container.resolve(Modules.PRICING)
    let list: any = (await pricing.listPriceLists({}, { take: null as any })).find((l: any) => l.title === SALE_PRICE_LIST_TITLE)
    const wanted = new Map<string, number>() // variant id → sale amount
    const managed = new Set<string>() // variant ids from this snapshot
    for (const p of this.snapshot.products) {
      for (const v of p.variants) {
        const id = this.variantTargets.get(v.source_id ?? `${p.handle}:${v.sku ?? v.title}`)
        if (!id) continue
        managed.add(id)
        const { sale } = priceModel(v.price, v.compare_at_price)
        if (sale !== null) wanted.set(id, sale)
      }
    }
    if (!list) {
      if (!wanted.size) return
      const { result } = await createPriceListsWorkflow(this.container).run({
        input: {
          price_lists_data: [
            {
              title: SALE_PRICE_LIST_TITLE,
              description: "Sale prices migrated from Shopify. Base variant price = compare-at (original) price; this list = the selling price.",
              type: "sale",
              status: "active",
              prices: [],
            } as any,
          ],
        },
      })
      list = result[0] as any
    }
    // Current prices in the list, keyed by variant id.
    const { data: variants } = await this.query.graph({
      entity: "product_variant",
      fields: ["id", "price_set.id"],
      filters: { id: [...managed] },
    })
    const psToVariant = new Map<string, string>()
    ;(variants as any[]).forEach((v) => v.price_set?.id && psToVariant.set(v.price_set.id, v.id))
    const current = psToVariant.size
      ? await pricing.listPrices({ price_list_id: [list!.id], price_set_id: [...psToVariant.keys()] } as any)
      : []
    const byVariant = new Map<string, any>()
    for (const pr of current as any[]) {
      const vid = psToVariant.get(pr.price_set_id)
      if (vid && pr.currency_code === this.ctx.currency) byVariant.set(vid, pr)
    }
    const create: any[] = []
    const update: any[] = []
    const del: string[] = []
    for (const vid of managed) {
      const want = wanted.get(vid)
      const have = byVariant.get(vid)
      if (want === undefined && have) del.push(have.id)
      else if (want !== undefined && !have) create.push({ variant_id: vid, amount: want, currency_code: this.ctx.currency })
      else if (want !== undefined && have && Number(have.amount) !== want)
        update.push({ id: have.id, variant_id: vid, amount: want, currency_code: this.ctx.currency })
    }
    if (create.length || update.length || del.length) {
      await batchPriceListPricesWorkflow(this.container).run({
        input: { data: { id: list!.id, create, update, delete: del } },
      })
    }
    this.report.sale_prices.set += create.length + update.length
    this.report.sale_prices.removed += del.length
  }

  // --------------------------------------------------------------- inventory

  private async syncInventory() {
    if (this.dry) return
    const inventory = this.container.resolve(Modules.INVENTORY)
    for (const p of this.snapshot.products) {
      for (const v of p.variants) {
        const vid = this.variantTargets.get(v.source_id ?? `${p.handle}:${v.sku ?? v.title}`)
        if (!vid) continue
        const known = v.inventory_quantity !== null && v.inventory_tracked !== false
        if (!known && v.available) {
          this.report.inventory.unmanaged_unknown++
          continue
        }
        const qty = known ? Math.max(0, v.inventory_quantity ?? 0) : 0
        const { data } = await this.query.graph({
          entity: "product_variant",
          fields: ["id", "inventory_items.inventory_item_id"],
          filters: { id: vid },
        })
        const itemId = (data[0] as any)?.inventory_items?.[0]?.inventory_item_id
        if (!itemId) {
          this.report.warnings.push(`${p.handle}: managed variant has no inventory item`)
          continue
        }
        const [level] = await inventory.listInventoryLevels({ inventory_item_id: itemId, location_id: this.ctx.locationId })
        if (!level) {
          await createInventoryLevelsWorkflow(this.container).run({
            input: { inventory_levels: [{ inventory_item_id: itemId, location_id: this.ctx.locationId, stocked_quantity: qty }] },
          })
          this.report.inventory.levels_created++
        } else if (known && Number(level.stocked_quantity) !== qty) {
          await updateInventoryLevelsWorkflow(this.container).run({
            input: { updates: [{ id: level.id, inventory_item_id: itemId, location_id: this.ctx.locationId, stocked_quantity: qty }] },
          })
          this.report.inventory.levels_updated++
        }
      }
    }
  }

  // --------------------------------------------------------------- categories

  private async importCollections() {
    const productModule = this.container.resolve(Modules.PRODUCT)
    const categoryTargets = new Map<string, string>() // category id by collection key
    for (const c of this.snapshot.collections) {
      const key = c.source_id ?? `handle:${c.handle}`
      try {
        const sum = checksum({ v: IMPORTER_MAPPING_VERSION, ...c })
        const mapping = await this.findMapping("collection", key)
        let targetId = mapping?.target_id ?? null
        let adopted = false
        if (!targetId) {
          const [byHandle] = await productModule.listProductCategories({ handle: c.handle })
          if (byHandle) {
            targetId = byHandle.id
            adopted = true
          }
        }
        let imageUrl: string | null = null
        if (c.image_src && (!mapping || mapping.checksum !== sum || this.opts.force)) {
          imageUrl = await this.ensureImage({ source_id: null, src: c.image_src, alt: c.image_alt, position: 1 }, `collection-${c.handle}`)
        } else if (mapping) {
          imageUrl = (mapping.metadata as any)?.image_url ?? null
        }
        const data = {
          name: c.title,
          handle: c.handle,
          description: c.description_html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          is_active: c.published,
          is_internal: false,
          metadata: {
            migrated_from: "shopify",
            shopify_collection_id: c.source_id,
            description_html: c.description_html,
            image_url: imageUrl,
            image_alt: c.image_alt || c.title,
            shopify_sort_order: c.sort_order,
            // Manual collection order (Shopify "Featured"), as handles so the
            // merchant can reorder in Admin → Category → Metadata.
            product_order: c.product_handles.join(","),
          },
        }
        if (targetId && !adopted && mapping?.checksum === sum && !this.opts.force) {
          this.report.categories.unchanged++
        } else if (this.dry) {
          if (!targetId) this.report.categories.created++
          else if (adopted) this.report.categories.adopted++
          else this.report.categories.updated++
        } else if (!targetId) {
          const { result } = await createProductCategoriesWorkflow(this.container).run({ input: { product_categories: [data] } })
          targetId = result[0].id
          this.report.categories.created++
        } else {
          await updateProductCategoriesWorkflow(this.container).run({ input: { selector: { id: targetId }, update: data } })
          if (adopted) this.report.categories.adopted++
          else this.report.categories.updated++
        }
        if (targetId) {
          categoryTargets.set(key, targetId)
          await this.saveMapping("collection", key, targetId, { handle: c.handle, checksum: sum, updated_at: c.updated_at, metadata: { image_url: imageUrl } })
        }
      } catch (e) {
        this.report.categories.failed++
        this.report.errors.push(`collection ${c.handle}: ${(e as Error).message}`)
      }
    }
    if (this.dry) return

    // Membership: Shopify collections are many-to-many → Medusa categories.
    const importedCategoryIds = new Set(categoryTargets.values())
    for (const p of this.snapshot.products) {
      const productId = this.productTargets.get(this.productKey(p))
      if (!productId) continue
      const wanted = this.snapshot.collections
        .filter((c) => (p.source_id && c.product_source_ids.includes(p.source_id)) || c.product_handles.includes(p.handle))
        .map((c) => categoryTargets.get(c.source_id ?? `handle:${c.handle}`))
        .filter(Boolean) as string[]
      const { data } = await this.query.graph({ entity: "product", fields: ["id", "categories.id"], filters: { id: productId } })
      const current: string[] = ((data[0] as any)?.categories ?? []).map((c: any) => c.id)
      // keep merchant-created (non-imported) categories
      const next = [...new Set([...current.filter((id) => !importedCategoryIds.has(id)), ...wanted])]
      if (next.sort().join() !== [...current].sort().join()) {
        await updateProductsWorkflow(this.container).run({ input: { products: [{ id: productId, category_ids: next } as any] } })
      }
    }
  }

  // ---------------------------------------------------------------- customers

  private async importCustomers(customers: NormalizedCustomer[]) {
    const customerModule = this.container.resolve(Modules.CUSTOMER)
    const authModule = this.container.resolve(Modules.AUTH)
    for (const c of customers) {
      try {
        if (!c.email) {
          this.report.customers.skipped++
          this.report.warnings.push(`customer ${c.source_id}: no email; skipped (Medusa customers are email-identified)`)
          continue
        }
        const email = c.email.toLowerCase()
        const sum = checksum(c)
        const mapping = await this.findMapping("customer", c.source_id)
        let targetId = mapping?.target_id ?? null
        let adopted = false
        if (!targetId) {
          const [existing] = await customerModule.listCustomers({ email })
          if (existing) {
            targetId = existing.id
            adopted = true
          }
        }
        if (targetId && !adopted && mapping?.checksum === sum && !this.opts.force) {
          this.report.customers.unchanged++
          continue
        }
        if (this.dry) {
          targetId ? (adopted ? this.report.customers.adopted++ : this.report.customers.updated++) : this.report.customers.created++
          continue
        }
        const addresses = c.addresses.map((a) => ({
          first_name: a.first_name ?? undefined,
          last_name: a.last_name ?? undefined,
          company: a.company ?? undefined,
          address_1: a.address_1 ?? undefined,
          address_2: a.address_2 ?? undefined,
          city: a.city ?? undefined,
          province: a.province ?? undefined,
          postal_code: a.postal_code ?? undefined,
          country_code: a.country_code ?? undefined,
          phone: a.phone ?? undefined,
          is_default_shipping: a.is_default,
          is_default_billing: a.is_default,
        }))
        const metadata = {
          migrated_from: "shopify",
          shopify_customer_id: c.source_id,
          accepts_marketing: c.accepts_marketing,
          shopify_tags: c.tags,
          shopify_created_at: c.created_at,
          activation: "pending",
        }
        if (!targetId) {
          const { result } = await createCustomersWorkflow(this.container).run({
            input: {
              customersData: [
                { email, first_name: c.first_name ?? undefined, last_name: c.last_name ?? undefined, phone: c.phone ?? undefined, has_account: true, metadata, addresses } as any,
              ],
            },
          })
          targetId = result[0].id
          this.report.customers.created++
        } else {
          await customerModule.updateCustomers(targetId, {
            first_name: c.first_name ?? undefined,
            last_name: c.last_name ?? undefined,
            phone: c.phone ?? undefined,
            metadata,
          } as any)
          adopted ? this.report.customers.adopted++ : this.report.customers.updated++
        }
        // Login identity with an unusable random password. The customer
        // sets their own password through the activation (reset) email.
        // Shopify password hashes are never read or imported.
        const identities = await authModule.listProviderIdentities({ entity_id: email, provider: "emailpass" })
        if (!identities.length) {
          const { authIdentity, error } = await authModule.register("emailpass", {
            body: { email, password: crypto.randomBytes(32).toString("base64url") },
          } as any)
          if (error || !authIdentity) throw new Error(`auth identity: ${error}`)
          await authModule.updateAuthIdentities({ id: authIdentity.id, app_metadata: { customer_id: targetId } })
        }
        await this.saveMapping("customer", c.source_id, targetId!, { checksum: sum, updated_at: c.updated_at, metadata: mapping?.metadata ?? { activation_sent_at: null } })
      } catch (e) {
        this.report.customers.failed++
        this.report.errors.push(`customer ${c.source_id}: ${(e as Error).message}`)
      }
    }
  }

  // ------------------------------------------------------------------- orders

  private async importOrders(orders: NormalizedOrder[]) {
    const orderModule = this.container.resolve(Modules.ORDER)
    for (const o of orders) {
      try {
        const mapping = await this.findMapping("order", o.source_id)
        if (mapping) {
          // Historical orders are immutable snapshots; never re-written.
          this.report.orders.unchanged++
          continue
        }
        if (this.dry) {
          this.report.orders.created++
          continue
        }
        const customerMap = o.customer_source_id ? await this.findMapping("customer", o.customer_source_id) : null
        const addr = (a: NormalizedOrder["shipping_address"]) =>
          a
            ? {
                first_name: a.first_name ?? undefined,
                last_name: a.last_name ?? undefined,
                company: a.company ?? undefined,
                address_1: a.address_1 ?? undefined,
                address_2: a.address_2 ?? undefined,
                city: a.city ?? undefined,
                province: a.province ?? undefined,
                postal_code: a.postal_code ?? undefined,
                country_code: a.country_code ?? undefined,
                phone: a.phone ?? undefined,
              }
            : undefined
        const items: any[] = []
        for (const l of o.lines) {
          const variantMap = l.variant_source_id ? await this.findMapping("variant", l.variant_source_id) : null
          const productMap = l.product_source_id ? await this.findMapping("product", l.product_source_id) : null
          items.push({
            title: l.title,
            subtitle: l.variant_title ?? undefined,
            quantity: l.quantity,
            unit_price: money(l.unit_price) ?? 0,
            is_tax_inclusive: o.taxes_included,
            requires_shipping: l.requires_shipping,
            product_id: productMap?.target_id,
            variant_id: variantMap?.target_id,
            variant_sku: l.sku ?? undefined,
            product_title: l.title,
            variant_title: l.variant_title ?? undefined,
            metadata: { shopify_line_item_id: l.source_id },
          })
        }
        const [created] = await orderModule.createOrders([
          {
            region_id: this.ctx.regionId ?? undefined,
            customer_id: customerMap?.target_id,
            sales_channel_id: this.ctx.salesChannelId,
            email: o.email ?? undefined,
            currency_code: o.currency_code,
            status: o.cancelled_at ? "canceled" : "completed",
            no_notification: true,
            items,
            shipping_address: addr(o.shipping_address),
            billing_address: addr(o.billing_address),
            shipping_methods: o.shipping_lines.map((s) => ({
              name: s.title,
              amount: money(s.price) ?? 0,
              is_tax_inclusive: o.taxes_included,
            })),
            metadata: {
              migrated_from: "shopify",
              historical: true,
              shopify_order_id: o.source_id,
              shopify_order_name: o.name,
              shopify_created_at: o.created_at,
              shopify_processed_at: o.processed_at,
              shopify_cancelled_at: o.cancelled_at,
              // Payment was handled by Shopify — NOT by a Medusa provider.
              shopify_financial_status: o.financial_status,
              shopify_fulfillment_status: o.fulfillment_status,
              shopify_totals: {
                subtotal: o.subtotal,
                tax: o.total_tax,
                shipping: o.total_shipping,
                discounts: o.total_discounts,
                total: o.total,
                taxes_included: o.taxes_included,
              },
              note: o.note,
              tags: o.tags,
            },
          } as any,
        ])
        await this.saveMapping("order", o.source_id, created.id, { handle: o.name, updated_at: o.created_at })
        this.report.orders.created++
      } catch (e) {
        this.report.orders.failed++
        this.report.errors.push(`order ${o.name}: ${(e as Error).message}`)
      }
    }
  }

  // --------------------------------------------------------------------- run

  async run(): Promise<ImportReport> {
    await this.loadContext()
    const run = this.dry
      ? null
      : await this.sparky.createMigrationRuns({ source: this.snapshot.kind, mode: this.opts.mode, status: "running" })
    try {
      const e = this.opts.entities
      if (e.includes("products") || e.includes("collections")) {
        this.log(`products: ${this.snapshot.products.length} in source`)
        await this.importProducts()
        await this.syncSalePrices()
        await this.syncInventory()
      }
      if (e.includes("collections")) {
        this.log(`collections: ${this.snapshot.collections.length} in source`)
        await this.importCollections()
      }
      if (e.includes("customers")) {
        if (!this.snapshot.customers) this.report.warnings.push("customers requested but source provides none")
        else await this.importCustomers(this.snapshot.customers)
      }
      if (e.includes("orders")) {
        if (!this.snapshot.orders) this.report.warnings.push("orders requested but source provides none")
        else await this.importOrders(this.snapshot.orders)
      }
      this.report.finished_at = new Date().toISOString()
      if (run) {
        await this.sparky.updateMigrationRuns({
          id: run.id,
          status: this.report.errors.length ? "failed" : "completed",
          stats: this.report as any,
          finished_at: new Date(),
          error: this.report.errors.slice(0, 20).join("\n") || null,
        })
      }
      return this.report
    } catch (e) {
      if (run) await this.sparky.updateMigrationRuns({ id: run.id, status: "failed", error: (e as Error).message, finished_at: new Date() })
      throw e
    }
  }
}
