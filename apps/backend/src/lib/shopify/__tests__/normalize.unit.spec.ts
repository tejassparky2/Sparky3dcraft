import fs from "node:fs"
import path from "node:path"
import { checksum, money, priceModel, sniffImage } from "../importer"
import { normalizeCsv, parseCsv } from "../sources/csv"
import { normalizePublicProduct } from "../sources/public-json"
import { normalizeAdminCustomer, normalizeAdminOrder, normalizeAdminProduct } from "../sources/admin-graphql"
import { gidToId } from "../types"

describe("price model (Shopify price/compare-at → Medusa base + sale list)", () => {
  it("uses compare-at as base when it is higher", () => {
    expect(priceModel("999.00", "1699.00")).toEqual({ base: 1699, sale: 999 })
  })
  it("ignores compare-at that is missing, equal or lower", () => {
    expect(priceModel("999.00", null)).toEqual({ base: 999, sale: null })
    expect(priceModel("999.00", "999.00")).toEqual({ base: 999, sale: null })
    expect(priceModel("999.00", "500.00")).toEqual({ base: 999, sale: null })
  })
  it("rejects invalid money", () => {
    expect(() => money("abc")).toThrow()
    expect(() => money("-5")).toThrow()
    expect(money("")).toBeNull()
  })
})

describe("identity", () => {
  it("normalizes GIDs and numeric IDs to the same key", () => {
    expect(gidToId("gid://shopify/Product/7268871143488")).toBe("7268871143488")
    expect(gidToId(7268871143488)).toBe("7268871143488")
    expect(gidToId("gid://shopify/MediaImage/123?x=1")).toBe("123")
    expect(gidToId(null)).toBeNull()
  })
  it("checksum is stable under key order", () => {
    expect(checksum({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(checksum({ b: [1, { d: 3, c: 2 }], a: 1 }))
  })
})

describe("public JSON normalization (live snapshot shape)", () => {
  const fixture = path.join(__dirname, "../../../../integration-tests/fixtures/shopify-public-products.json")
  const data = JSON.parse(fs.readFileSync(fixture, "utf8"))
  it("normalizes every product with prices and images", () => {
    const products = data.products.map(normalizePublicProduct)
    expect(products.length).toBe(data.products.length)
    for (const p of products) {
      expect(p.source_id).toMatch(/^\d+$/)
      expect(p.handle).toBeTruthy()
      expect(p.variants.length).toBeGreaterThan(0)
      for (const v of p.variants) {
        expect(Number(v.price)).toBeGreaterThan(0)
        expect(v.inventory_quantity).toBeNull() // unknown from public source
      }
      for (const img of p.images) expect(img.src).toMatch(/^https:\/\//)
    }
  })
})

describe("Admin GraphQL normalization", () => {
  it("maps product, variants, media, inventory and status", () => {
    const p = normalizeAdminProduct({
      id: "gid://shopify/Product/1",
      handle: "h",
      title: "T",
      descriptionHtml: "<p>x</p>",
      status: "ACTIVE",
      publishedAt: "2026-01-01T00:00:00Z",
      productType: "",
      vendor: "V",
      tags: ["a"],
      seo: { title: "S", description: null },
      options: [{ name: "Size", values: ["S", "M"] }],
      media: { nodes: [{ id: "gid://shopify/MediaImage/9", alt: "", image: { url: "https://cdn/x.png", width: 10, height: 10 } }, {}] },
      variants: {
        nodes: [
          { id: "gid://shopify/ProductVariant/2", title: "S", sku: "SKU-S", price: "10.00", compareAtPrice: "12.00", inventoryQuantity: 4, inventoryPolicy: "DENY", availableForSale: true, selectedOptions: [{ name: "Size", value: "S" }], inventoryItem: { tracked: true, requiresShipping: true, measurement: { weight: { unit: "KILOGRAMS", value: 0.3 } } } },
        ],
      },
    })
    expect(p.status).toBe("published")
    expect(p.images).toHaveLength(1)
    expect(p.images[0].alt).toBeNull()
    expect(p.variants[0]).toMatchObject({ source_id: "2", sku: "SKU-S", inventory_quantity: 4, inventory_tracked: true, grams: 300, option_values: { Size: "S" } })
    expect(normalizeAdminProduct({ id: "gid://shopify/Product/3", status: "DRAFT", options: [], variants: { nodes: [] } }).status).toBe("draft")
  })
  it("maps customers without any password material", () => {
    const c = normalizeAdminCustomer({ id: "gid://shopify/Customer/5", firstName: "A", defaultEmailAddress: { emailAddress: "a@example.com", marketingState: "SUBSCRIBED" }, defaultAddress: { id: "x" }, addressesV2: { nodes: [{ id: "x", city: "Bengaluru", countryCodeV2: "IN" }] } })
    expect(c).toMatchObject({ source_id: "5", email: "a@example.com", accepts_marketing: true })
    expect(c.addresses[0]).toMatchObject({ city: "Bengaluru", country_code: "in", is_default: true })
    expect(JSON.stringify(c)).not.toMatch(/password/i)
  })
  it("maps orders keeping Shopify identifiers and statuses", () => {
    const o = normalizeAdminOrder({ id: "gid://shopify/Order/77", name: "#1001", currencyCode: "INR", createdAt: "2026-01-01T00:00:00Z", displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED", totalPriceSet: { shopMoney: { amount: "1078.0" } }, taxesIncluded: true, lineItems: { nodes: [{ id: "gid://shopify/LineItem/8", title: "Lamp", quantity: 1, originalUnitPriceSet: { shopMoney: { amount: "999.0" } }, variant: { id: "gid://shopify/ProductVariant/2" } }] } })
    expect(o).toMatchObject({ source_id: "77", order_number: 1001, currency_code: "inr", financial_status: "PAID", total: "1078.0" })
    expect(o.lines[0]).toMatchObject({ variant_source_id: "2", quantity: 1, unit_price: "999.0" })
  })
})

describe("CSV", () => {
  it("parses quoted fields, embedded commas/newlines and escaped quotes", () => {
    const rows = parseCsv('a,b,c\r\n"x, y","line1\nline2","say ""hi"""\n')
    expect(rows).toEqual([["a", "b", "c"], ["x, y", "line1\nline2", 'say "hi"']])
  })
  it("groups Shopify export rows into products/variants/images", () => {
    const csv = [
      "Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Option1 Name,Option1 Value,Variant SKU,Variant Grams,Variant Inventory Tracker,Variant Inventory Qty,Variant Inventory Policy,Variant Price,Variant Compare At Price,Variant Requires Shipping,Variant Taxable,Image Src,Image Position,Image Alt Text,Status",
      'lamp,Lamp,"<p>Hi, there</p>",V,Gift,"a, b",true,Size,S,L-S,300,shopify,5,deny,999.00,1299.00,true,true,https://cdn/1.png,1,Front,active',
      "lamp,,,,,,,,M,L-M,300,shopify,0,deny,1099.00,,true,true,https://cdn/2.png,2,,",
      "draft-thing,Draft,,V,,,false,Title,Default Title,,0,,,deny,10.00,,true,true,,,,draft",
    ].join("\n")
    const { products } = normalizeCsv(csv)
    expect(products).toHaveLength(2)
    const lamp = products.find((p) => p.handle === "lamp")!
    expect(lamp.tags).toEqual(["a", "b"])
    expect(lamp.variants.map((v) => [v.sku, v.inventory_quantity, v.available])).toEqual([["L-S", 5, true], ["L-M", 0, false]])
    expect(lamp.options[0]).toEqual({ name: "Size", values: ["S", "M"] })
    expect(lamp.images.map((i) => i.alt)).toEqual(["Front", null])
    expect(products.find((p) => p.handle === "draft-thing")!.status).toBe("draft")
  })
  it("rejects non-Shopify CSV", () => {
    expect(() => normalizeCsv("foo,bar\n1,2")).toThrow(/Handle/)
  })
})

describe("image sniffing", () => {
  it("recognises real image signatures and rejects HTML", () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0]))).toBe("image/png")
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg")
    expect(sniffImage(Buffer.from("<html><body>blocked</body></html>"))).toBeNull()
  })
})
