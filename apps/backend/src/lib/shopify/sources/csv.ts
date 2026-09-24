/**
 * Shopify product CSV export (Admin → Products → Export → "CSV for Excel,
 * Numbers, or other spreadsheet programs").
 *
 * Limitations (see docs/MIGRATION.md):
 *  - no Shopify IDs → identity is the product handle (unique in Medusa)
 *  - no collections (Shopify does not export them in the product CSV)
 *  - inventory quantity only if "Variant Inventory Qty" is present
 *  - no customers / orders
 */
import fs from "node:fs"
import type { NormalizedImage, NormalizedProduct, SourceSnapshot } from "../types"

/** RFC 4180 parser: quoted fields, escaped quotes, embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let i = 0
  let inQuotes = false
  if (text.charCodeAt(0) === 0xfeff) i = 1 // BOM
  for (; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += c
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""))
}

export function normalizeCsv(text: string): { products: NormalizedProduct[]; warnings: string[] } {
  const rows = parseCsv(text)
  if (!rows.length) return { products: [], warnings: ["empty CSV"] }
  const header = rows[0].map((h) => h.trim())
  const col = (name: string) => header.indexOf(name)
  if (col("Handle") < 0) throw new Error("Not a Shopify product CSV: missing 'Handle' column")
  const get = (r: string[], name: string) => {
    const i = col(name)
    return i >= 0 ? (r[i] ?? "").trim() : ""
  }
  const byHandle = new Map<string, NormalizedProduct>()
  const optionNames = new Map<string, string[]>()
  const warnings: string[] = []

  for (const r of rows.slice(1)) {
    const handle = get(r, "Handle")
    if (!handle) continue
    let p = byHandle.get(handle)
    if (!p) {
      const status = get(r, "Status").toLowerCase()
      const published = get(r, "Published").toLowerCase()
      p = {
        source_id: null,
        handle,
        title: get(r, "Title") || handle,
        description_html: get(r, "Body (HTML)"),
        status: status === "active" || (!status && published === "true") ? "published" : "draft",
        product_type: get(r, "Type") || null,
        vendor: get(r, "Vendor") || null,
        tags: get(r, "Tags").split(",").map((t) => t.trim()).filter(Boolean),
        options: [],
        variants: [],
        images: [],
        videos: [],
        seo_title: get(r, "SEO Title") || null,
        seo_description: get(r, "SEO Description") || null,
        created_at: null,
        updated_at: null,
        published_at: null,
      }
      const names = [1, 2, 3].map((n) => get(r, `Option${n} Name`)).filter(Boolean)
      optionNames.set(handle, names)
      p.options = names.map((name) => ({ name, values: [] }))
      byHandle.set(handle, p)
    }
    const names = optionNames.get(handle) ?? []
    const price = get(r, "Variant Price")
    if (price) {
      const option_values: Record<string, string> = {}
      names.forEach((name, idx) => {
        const v = get(r, `Option${idx + 1} Value`)
        if (v) {
          option_values[name] = v
          const opt = p!.options.find((o) => o.name === name)
          if (opt && !opt.values.includes(v)) opt.values.push(v)
        }
      })
      const qty = get(r, "Variant Inventory Qty")
      const tracker = get(r, "Variant Inventory Tracker")
      const unit = get(r, "Variant Weight Unit")
      const gramsRaw = get(r, "Variant Grams")
      p.variants.push({
        source_id: null,
        title: Object.values(option_values).join(" / ") || "Default Title",
        sku: get(r, "Variant SKU").replace(/^'/, "") || null,
        barcode: get(r, "Variant Barcode").replace(/^'/, "") || null,
        price,
        compare_at_price: get(r, "Variant Compare At Price") || null,
        grams: gramsRaw ? Math.round(Number(gramsRaw)) : null,
        requires_shipping: get(r, "Variant Requires Shipping").toLowerCase() !== "false",
        taxable: get(r, "Variant Taxable").toLowerCase() !== "false",
        available: qty === "" ? true : Number(qty) > 0 || get(r, "Variant Inventory Policy") === "continue",
        inventory_quantity: qty === "" ? null : Number(qty),
        inventory_tracked: tracker ? tracker === "shopify" : null,
        allow_backorder: get(r, "Variant Inventory Policy") === "continue",
        option_values,
        image_source_id: null,
        position: p.variants.length + 1,
      })
      if (unit && unit !== "g" && unit !== "kg" && !gramsRaw) {
        warnings.push(`${handle}: weight unit ${unit} without grams column`)
      }
    }
    const src = get(r, "Image Src")
    if (src && !p.images.some((im) => im.src === src)) {
      const img: NormalizedImage = {
        source_id: null,
        src,
        alt: get(r, "Image Alt Text") || null,
        position: Number(get(r, "Image Position")) || p.images.length + 1,
      }
      p.images.push(img)
    }
  }
  for (const p of byHandle.values()) {
    p.images.sort((a, b) => a.position - b.position)
    if (!p.options.length) p.options = [{ name: "Title", values: ["Default Title"] }]
    if (!p.variants.length) warnings.push(`${p.handle}: no variant rows (skipped)`)
  }
  return { products: [...byHandle.values()].filter((p) => p.variants.length), warnings }
}

export function readCsvSnapshot(file: string): SourceSnapshot {
  const { products, warnings } = normalizeCsv(fs.readFileSync(file, "utf8"))
  return {
    kind: "shopify-csv",
    fetched_at: new Date().toISOString(),
    shop: file,
    products,
    collections: [],
    warnings: [
      "shopify-csv source: no Shopify IDs (matched by handle), no collections, no customers/orders",
      ...warnings,
    ],
  }
}
