#!/usr/bin/env node
/**
 * Shopify Admin GraphQL API TEST DOUBLE (local/CI only).
 * Products/collections are derived from the real public snapshot in
 * apps/backend/integration-tests/fixtures/shopify-public-products.json;
 * customers and orders are SYNTHETIC test fixtures (not real people).
 * Env: PORT (default 9922), TOKEN (default shpat_test_fixture)
 */
import http from "node:http"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 9922)
const TOKEN = process.env.TOKEN || "shpat_test_fixture"
const pub = JSON.parse(fs.readFileSync(path.join(here, "../../apps/backend/integration-tests/fixtures/shopify-public-products.json"), "utf8")).products

const gid = (t, id) => `gid://shopify/${t}/${id}`
const products = pub.map((p, i) => ({
  id: gid("Product", p.id),
  handle: p.handle,
  title: p.title,
  descriptionHtml: p.body_html,
  status: "ACTIVE",
  productType: p.product_type,
  vendor: p.vendor,
  tags: p.tags,
  createdAt: p.created_at,
  updatedAt: p.updated_at,
  publishedAt: p.published_at,
  seo: { title: null, description: null },
  options: p.options.map((o) => ({ name: o.name, values: o.values })),
  media: { nodes: p.images.map((img) => ({ id: gid("MediaImage", img.id), alt: i === 0 ? "Fixture alt text" : "", image: { url: img.src, width: img.width, height: img.height } })) },
  variants: {
    nodes: p.variants.map((v) => ({
      id: gid("ProductVariant", v.id),
      title: v.title,
      sku: v.sku,
      barcode: null,
      price: v.price,
      compareAtPrice: v.compare_at_price,
      position: v.position,
      inventoryQuantity: 5 + i, // fixture stock levels
      inventoryPolicy: "DENY",
      taxable: true,
      availableForSale: true,
      selectedOptions: [{ name: "Title", value: v.title }],
      image: null,
      inventoryItem: { tracked: true, requiresShipping: true, measurement: { weight: { unit: "GRAMS", value: v.grams } } },
    })),
  },
}))
const collections = [
  { id: gid("Collection", 284857729088), handle: "customized-gifts", title: "Personalized Gifts", descriptionHtml: "", sortOrder: "MANUAL", updatedAt: "2026-06-10T00:00:00Z", image: null, products: { nodes: ["cute-little-bene-krishna", "customized-lithophane-lamp"].map((h) => ({ id: products.find((p) => p.handle === h).id, handle: h })) } },
  { id: gid("Collection", 284857991232), handle: "customized-idols", title: "Rayara Idols", descriptionHtml: "", sortOrder: "MANUAL", updatedAt: "2026-06-10T00:00:00Z", image: null, products: { nodes: ["raghavendra-swamy", "krishna-rayaru", "vene-rayaru", "rayara-mantrakshate-ring"].map((h) => ({ id: products.find((p) => p.handle === h).id, handle: h })) } },
]
const addr = (city) => ({ firstName: "Fixture", lastName: "Customer", company: null, address1: "1 Fixture Street", address2: null, city, province: "Karnataka", zip: "560001", countryCodeV2: "IN", phone: "+919000000000" })
const customers = [1, 2, 3].map((n) => ({
  id: gid("Customer", 900000 + n),
  firstName: `Fixture${n}`,
  lastName: "Customer",
  createdAt: "2026-07-01T10:00:00Z",
  updatedAt: "2026-07-01T10:00:00Z",
  tags: [],
  note: null,
  defaultEmailAddress: { emailAddress: `fixture.customer${n}@example.com`, marketingState: n === 1 ? "SUBSCRIBED" : "NOT_SUBSCRIBED" },
  defaultPhoneNumber: null,
  defaultAddress: { id: gid("MailingAddress", 800000 + n) },
  addressesV2: { nodes: [{ id: gid("MailingAddress", 800000 + n), ...addr("Bengaluru") }] },
}))
const lamp = products.find((p) => p.handle === "shiva-shadow-lamp")
const money = (a) => ({ shopMoney: { amount: a, currencyCode: "INR" } })
const orders = [1, 2].map((n) => ({
  id: gid("Order", 700000 + n),
  name: `#${1000 + n}`,
  email: `fixture.customer${n}@example.com`,
  createdAt: `2026-08-0${n}T12:00:00Z`,
  processedAt: `2026-08-0${n}T12:00:00Z`,
  cancelledAt: null,
  note: null,
  tags: [],
  taxesIncluded: true,
  currencyCode: "INR",
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: n === 1 ? "FULFILLED" : "UNFULFILLED",
  customer: { id: gid("Customer", 900000 + n) },
  subtotalPriceSet: money("999.0"),
  totalTaxSet: money("152.39"),
  totalShippingPriceSet: money("0.0"),
  totalDiscountsSet: money("0.0"),
  totalPriceSet: money("999.0"),
  shippingAddress: addr("Bengaluru"),
  billingAddress: addr("Bengaluru"),
  shippingLines: { nodes: [{ title: "Standard", originalPriceSet: money("0.0") }] },
  lineItems: { nodes: [{ id: gid("LineItem", 600000 + n), title: lamp.title, variantTitle: null, sku: null, quantity: 1, requiresShipping: true, originalUnitPriceSet: money("999.0"), product: { id: lamp.id }, variant: { id: lamp.variants.nodes[0].id } }] },
}))
const data = { products, collections, customers, orders }

function page(list, first, after) {
  const start = after ? Number(Buffer.from(after, "base64").toString()) : 0
  const nodes = list.slice(start, start + first)
  const end = start + nodes.length
  return { nodes, pageInfo: { hasNextPage: end < list.length, endCursor: Buffer.from(String(end)).toString("base64") } }
}

http
  .createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const send = (s, o) => {
        res.writeHead(s, { "content-type": "application/json" })
        res.end(JSON.stringify(o))
      }
      if (!/\/admin\/api\/[\d-]+\/graphql\.json$/.test(req.url) && !/\/[\d-]+\/graphql\.json$/.test(req.url)) return send(404, { errors: "Not Found" })
      if (req.headers["x-shopify-access-token"] !== TOKEN) return send(401, { errors: "[API] Invalid API key or access token" })
      const { query, variables = {} } = JSON.parse(body || "{}")
      if (/\{\s*shop\s*\{/.test(query)) return send(200, { data: { shop: { name: "SPARKY 3D CRAFT CO (fixture)", myshopifyDomain: "fixture.myshopify.com", currencyCode: "INR", taxesIncluded: true } } })
      const root = /\b(products|collections|customers|orders)\(first:\s*(\d+)/.exec(query)
      if (!root) return send(200, { errors: [{ message: "unsupported query in test double" }] })
      return send(200, { data: { [root[1]]: page(data[root[1]], Number(root[2]), variables.after) } })
    })
  })
  .listen(PORT, "127.0.0.1", () => console.log(`shopify admin test double on http://127.0.0.1:${PORT}`))
