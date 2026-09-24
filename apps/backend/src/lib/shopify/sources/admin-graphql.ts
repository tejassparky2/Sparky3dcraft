/**
 * Shopify Admin GraphQL API source (requires a custom-app Admin API access
 * token with read_products, read_inventory, read_customers, read_orders and —
 * for orders older than 60 days — read_all_orders).
 *
 * The live store has NOT been queried with this source from the build
 * environment (no credentials were available). Run `IMPORT_MODE=probe` first:
 * it executes a minimal query per entity and fails loudly on any schema
 * mismatch, before anything is written to Medusa.
 */
import type {
  NormalizedAddress,
  NormalizedCollection,
  NormalizedCustomer,
  NormalizedOrder,
  NormalizedProduct,
  SourceSnapshot,
} from "../types"
import { gidToId, pickMp4 } from "../types"
import { fetchWithRetry, sleep } from "./http"

export type AdminOpts = {
  shopDomain: string // "xyz.myshopify.com"
  accessToken: string
  apiVersion: string // e.g. "2026-07"
  /** TEST ONLY: override https://<shop>/admin/api (points at tests/fakes/shopify-admin-fake.mjs). */
  baseUrl?: string
  fetchImpl?: typeof fetch
}

export class ShopifyGraphQLError extends Error {}

export async function gql<T = any>(opts: AdminOpts, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const base = (opts.baseUrl ?? `https://${opts.shopDomain}/admin/api`).replace(/\/$/, "")
  const url = `${base}/${opts.apiVersion}/graphql.json`
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Shopify-Access-Token": opts.accessToken,
        },
        body: JSON.stringify({ query, variables }),
      },
      { fetchImpl: opts.fetchImpl }
    )
    if (res.status === 401 || res.status === 403) {
      throw new ShopifyGraphQLError(`Shopify Admin API auth failed (HTTP ${res.status}); check token scopes`)
    }
    if (!res.ok) throw new ShopifyGraphQLError(`Shopify Admin API HTTP ${res.status}`)
    const json: any = await res.json()
    const throttled = json.errors?.some((e: any) => e?.extensions?.code === "THROTTLED")
    if (throttled) {
      await sleep(1000 * 2 ** attempt)
      continue
    }
    if (json.errors?.length) {
      throw new ShopifyGraphQLError(
        "Shopify GraphQL errors: " + json.errors.map((e: any) => e.message).join("; ")
      )
    }
    return json.data as T
  }
  throw new ShopifyGraphQLError("Shopify Admin API throttled repeatedly")
}

async function* pages<T>(
  opts: AdminOpts,
  query: string,
  root: string,
  variables: Record<string, unknown> = {}
): AsyncGenerator<T[]> {
  let after: string | null = null
  for (let i = 0; i < 10000; i++) {
    const data: any = await gql(opts, query, { ...variables, after })
    const conn = data[root]
    yield conn.nodes as T[]
    if (!conn.pageInfo?.hasNextPage) return
    after = conn.pageInfo.endCursor
  }
}

const money = (set: any): string | null => set?.shopMoney?.amount ?? null

function addr(a: any): NormalizedAddress | null {
  if (!a) return null
  return {
    first_name: a.firstName ?? null,
    last_name: a.lastName ?? null,
    company: a.company ?? null,
    address_1: a.address1 ?? null,
    address_2: a.address2 ?? null,
    city: a.city ?? null,
    province: a.province ?? null,
    postal_code: a.zip ?? null,
    country_code: a.countryCodeV2 ? String(a.countryCodeV2).toLowerCase() : null,
    phone: a.phone ?? null,
  }
}

const ADDRESS_FIELDS = `firstName lastName company address1 address2 city province zip countryCodeV2 phone`

const PRODUCTS_QUERY = `query Products($after: String) {
  products(first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id handle title descriptionHtml status productType vendor tags
      createdAt updatedAt publishedAt
      seo { title description }
      options { name values }
      media(first: 50) {
        nodes {
          ... on MediaImage { id alt image { url width height } }
          ... on Video { id alt sources { url mimeType width height } preview { image { url } } }
        }
      }
      variants(first: 100) {
        nodes {
          id title sku barcode price compareAtPrice position
          inventoryQuantity inventoryPolicy taxable availableForSale
          selectedOptions { name value }
          image { id }
          inventoryItem { tracked requiresShipping measurement { weight { unit value } } }
        }
      }
    }
  }
}`

const COLLECTIONS_QUERY = `query Collections($after: String) {
  collections(first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id handle title descriptionHtml sortOrder updatedAt
      image { url altText }
      products(first: 250) { nodes { id handle } }
    }
  }
}`

const CUSTOMERS_QUERY = `query Customers($after: String) {
  customers(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id firstName lastName createdAt updatedAt tags note
      defaultEmailAddress { emailAddress marketingState }
      defaultPhoneNumber { phoneNumber }
      defaultAddress { id }
      addressesV2(first: 20) { nodes { id ${ADDRESS_FIELDS} } }
    }
  }
}`

const ORDERS_QUERY = `query Orders($after: String) {
  orders(first: 50, after: $after, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name email createdAt processedAt cancelledAt note tags taxesIncluded
      currencyCode displayFinancialStatus displayFulfillmentStatus
      customer { id }
      subtotalPriceSet { shopMoney { amount } }
      totalTaxSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalPriceSet { shopMoney { amount } }
      shippingAddress { ${ADDRESS_FIELDS} }
      billingAddress { ${ADDRESS_FIELDS} }
      shippingLines(first: 10) { nodes { title originalPriceSet { shopMoney { amount } } } }
      lineItems(first: 100) {
        nodes {
          id title variantTitle sku quantity requiresShipping
          originalUnitPriceSet { shopMoney { amount } }
          product { id } variant { id }
        }
      }
    }
  }
}`

function weightToGrams(w: any): number | null {
  if (!w || typeof w.value !== "number") return null
  const f: Record<string, number> = { GRAMS: 1, KILOGRAMS: 1000, OUNCES: 28.3495, POUNDS: 453.592 }
  return Math.round(w.value * (f[w.unit] ?? 1))
}

export function normalizeAdminProduct(p: any): NormalizedProduct {
  const images = (p.media?.nodes ?? [])
    .filter((m: any) => m?.image?.url)
    .map((m: any, i: number) => ({
      source_id: gidToId(m.id),
      src: m.image.url,
      alt: m.alt || null,
      position: i + 1,
      width: m.image.width ?? null,
      height: m.image.height ?? null,
    }))
  const videos = (p.media?.nodes ?? [])
    .map((m: any, i: number) => ({ m, i }))
    .filter(({ m }: any) => Array.isArray(m?.sources))
    .map(({ m, i }: any) => {
      const src = pickMp4(m.sources.map((s: any) => ({ mime: s.mimeType, url: s.url, width: s.width, height: s.height })))
      return src
        ? { source_id: gidToId(m.id), src: src.url, mime: "video/mp4", width: src.width ?? null, height: src.height ?? null, position: i + 1, poster_src: m.preview?.image?.url ?? null, alt: m.alt || null }
        : null
    })
    .filter(Boolean)
  return {
    source_id: gidToId(p.id),
    handle: p.handle,
    title: p.title,
    description_html: p.descriptionHtml ?? "",
    status: p.status === "ACTIVE" && p.publishedAt ? "published" : "draft",
    product_type: p.productType || null,
    vendor: p.vendor || null,
    tags: p.tags ?? [],
    options: (p.options ?? []).map((o: any) => ({ name: o.name, values: o.values ?? [] })),
    variants: (p.variants?.nodes ?? []).map((v: any, i: number) => ({
      source_id: gidToId(v.id),
      title: v.title,
      sku: v.sku || null,
      barcode: v.barcode || null,
      price: String(v.price),
      compare_at_price: v.compareAtPrice ? String(v.compareAtPrice) : null,
      grams: weightToGrams(v.inventoryItem?.measurement?.weight),
      requires_shipping: v.inventoryItem?.requiresShipping !== false,
      taxable: v.taxable !== false,
      available: v.availableForSale !== false,
      inventory_quantity: typeof v.inventoryQuantity === "number" ? v.inventoryQuantity : null,
      inventory_tracked: typeof v.inventoryItem?.tracked === "boolean" ? v.inventoryItem.tracked : null,
      allow_backorder: v.inventoryPolicy === "CONTINUE",
      option_values: Object.fromEntries((v.selectedOptions ?? []).map((o: any) => [o.name, o.value])),
      image_source_id: gidToId(v.image?.id ?? null),
      position: v.position ?? i + 1,
    })),
    images,
    videos,
    seo_title: p.seo?.title || null,
    seo_description: p.seo?.description || null,
    created_at: p.createdAt ?? null,
    updated_at: p.updatedAt ?? null,
    published_at: p.publishedAt ?? null,
  }
}

export function normalizeAdminCustomer(c: any): NormalizedCustomer {
  const defaultId = c.defaultAddress?.id
  return {
    source_id: gidToId(c.id)!,
    email: c.defaultEmailAddress?.emailAddress ?? null,
    first_name: c.firstName ?? null,
    last_name: c.lastName ?? null,
    phone: c.defaultPhoneNumber?.phoneNumber ?? null,
    accepts_marketing: c.defaultEmailAddress?.marketingState === "SUBSCRIBED",
    addresses: (c.addressesV2?.nodes ?? []).map((a: any) => ({ ...addr(a)!, is_default: a.id === defaultId })),
    created_at: c.createdAt ?? null,
    updated_at: c.updatedAt ?? null,
    tags: c.tags ?? [],
    note: c.note ?? null,
  }
}

export function normalizeAdminOrder(o: any): NormalizedOrder {
  const num = /^#?(\d+)$/.exec(String(o.name ?? ""))
  return {
    source_id: gidToId(o.id)!,
    name: o.name,
    order_number: num ? Number(num[1]) : null,
    email: o.email ?? null,
    customer_source_id: gidToId(o.customer?.id ?? null),
    currency_code: String(o.currencyCode ?? "INR").toLowerCase(),
    created_at: o.createdAt,
    processed_at: o.processedAt ?? null,
    cancelled_at: o.cancelledAt ?? null,
    financial_status: o.displayFinancialStatus ?? null,
    fulfillment_status: o.displayFulfillmentStatus ?? null,
    subtotal: money(o.subtotalPriceSet),
    total_tax: money(o.totalTaxSet),
    total_shipping: money(o.totalShippingPriceSet),
    total_discounts: money(o.totalDiscountsSet),
    total: money(o.totalPriceSet) ?? "0",
    taxes_included: !!o.taxesIncluded,
    shipping_address: addr(o.shippingAddress),
    billing_address: addr(o.billingAddress),
    shipping_lines: (o.shippingLines?.nodes ?? []).map((s: any) => ({
      title: s.title,
      price: money(s.originalPriceSet) ?? "0",
    })),
    lines: (o.lineItems?.nodes ?? []).map((l: any) => ({
      source_id: gidToId(l.id)!,
      title: l.title,
      variant_title: l.variantTitle ?? null,
      sku: l.sku ?? null,
      quantity: l.quantity,
      unit_price: money(l.originalUnitPriceSet) ?? "0",
      product_source_id: gidToId(l.product?.id ?? null),
      variant_source_id: gidToId(l.variant?.id ?? null),
      requires_shipping: l.requiresShipping !== false,
    })),
    note: o.note ?? null,
    tags: o.tags ?? [],
  }
}

/** Minimal queries that validate credentials, scopes and schema. */
export async function probeAdmin(opts: AdminOpts, entities: string[]): Promise<string[]> {
  const results: string[] = []
  const shop = await gql(opts, `{ shop { name myshopifyDomain currencyCode taxesIncluded } }`)
  results.push(`shop: ${shop.shop.name} (${shop.shop.myshopifyDomain}) currency=${shop.shop.currencyCode} taxesIncluded=${shop.shop.taxesIncluded}`)
  const one = (q: string) => q.replace(/first: (50|100)/, "first: 1")
  if (entities.includes("products")) {
    const d = await gql(opts, one(PRODUCTS_QUERY), { after: null })
    results.push(`products query OK (${d.products.nodes.length} sample)`)
  }
  if (entities.includes("collections")) {
    const d = await gql(opts, one(COLLECTIONS_QUERY), { after: null })
    results.push(`collections query OK (${d.collections.nodes.length} sample)`)
  }
  if (entities.includes("customers")) {
    const d = await gql(opts, one(CUSTOMERS_QUERY), { after: null })
    results.push(`customers query OK (${d.customers.nodes.length} sample)`)
  }
  if (entities.includes("orders")) {
    const d = await gql(opts, one(ORDERS_QUERY), { after: null })
    results.push(`orders query OK (${d.orders.nodes.length} sample)`)
  }
  return results
}

export async function fetchAdminSnapshot(opts: AdminOpts, entities: string[]): Promise<SourceSnapshot> {
  const snapshot: SourceSnapshot = {
    kind: "shopify-admin",
    fetched_at: new Date().toISOString(),
    shop: opts.shopDomain,
    products: [],
    collections: [],
    warnings: [],
  }
  if (entities.includes("products") || entities.includes("collections")) {
    for await (const nodes of pages<any>(opts, PRODUCTS_QUERY, "products")) {
      snapshot.products.push(...nodes.map(normalizeAdminProduct))
    }
  }
  if (entities.includes("collections")) {
    for await (const nodes of pages<any>(opts, COLLECTIONS_QUERY, "collections")) {
      for (const c of nodes) {
        const col: NormalizedCollection = {
          source_id: gidToId(c.id),
          handle: c.handle,
          title: c.title,
          description_html: c.descriptionHtml ?? "",
          image_src: c.image?.url ?? null,
          image_alt: c.image?.altText ?? null,
          product_source_ids: (c.products?.nodes ?? []).map((p: any) => gidToId(p.id)!).filter(Boolean),
          product_handles: (c.products?.nodes ?? []).map((p: any) => p.handle),
          sort_order: c.sortOrder ?? null,
          updated_at: c.updatedAt ?? null,
          published: true,
        }
        snapshot.collections.push(col)
      }
    }
  }
  if (entities.includes("customers")) {
    snapshot.customers = []
    for await (const nodes of pages<any>(opts, CUSTOMERS_QUERY, "customers")) {
      snapshot.customers.push(...nodes.map(normalizeAdminCustomer))
    }
  }
  if (entities.includes("orders")) {
    snapshot.orders = []
    for await (const nodes of pages<any>(opts, ORDERS_QUERY, "orders")) {
      snapshot.orders.push(...nodes.map(normalizeAdminOrder))
    }
  }
  return snapshot
}
