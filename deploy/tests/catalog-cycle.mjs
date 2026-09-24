// §54 catalog test on a live server: Admin API changes must appear on the
// public storefront without any code change or rebuild. Cleans up after itself.
import { adminSession, env, eventually, page } from "./lib.mjs"

const API = env("API_URL"), STORE = env("STORE_URL")
const admin = await adminSession(API, env("ADMIN_EMAIL"), env("ADMIN_PASSWORD"))
const handle = `sparky-verify-${Date.now().toString(36)}`
let productId, tempList
try {
  const { stores } = await admin("GET", "/admin/stores")
  const { shipping_profiles } = await admin("GET", "/admin/shipping-profiles?type=default")
  const { product } = await admin("POST", "/admin/products", {
    title: "Verification Item", handle, status: "published",
    options: [{ title: "Title", values: ["Default Title"] }],
    variants: [{ title: "Default Title", options: { Title: "Default Title" }, manage_inventory: false, prices: [{ currency_code: "inr", amount: 1234 }] }],
    sales_channels: [{ id: stores[0].default_sales_channel_id }], shipping_profile_id: shipping_profiles[0].id,
  })
  productId = product.id
  const variantId = product.variants[0].id
  const url = `${STORE}/products/${handle}`
  await eventually("create → visible", async () => { const p = await page(url); return p.status === 200 && p.html.includes("Verification Item") })
  await admin("POST", `/admin/products/${productId}`, { title: "Verification Item Renamed" })
  await eventually("edit title → updated", async () => (await page(url)).html.includes("Verification Item Renamed"))
  await admin("POST", `/admin/products/${productId}/variants/${variantId}`, { prices: [{ currency_code: "inr", amount: 1500 }] })
  await eventually("edit price → updated", async () => (await page(url)).html.includes("1,500.00"))
  const { price_list } = await admin("POST", "/admin/price-lists", { title: `verify-${handle}`, description: "temporary verification list", type: "sale", status: "active", prices: [{ variant_id: variantId, currency_code: "inr", amount: 1100 }] })
  tempList = price_list.id
  await eventually("compare-at/sale → struck price + Sale badge", async () => { const h = (await page(url)).html; return h.includes("1,100.00") && h.includes("1,500.00") && h.includes(">Sale<") }, 90)
  await admin("POST", `/admin/products/${productId}/variants/${variantId}`, { manage_inventory: true })
  const { variant } = await admin("GET", `/admin/products/${productId}/variants/${variantId}?fields=inventory_items.inventory_item_id`)
  const item = variant.inventory_items[0].inventory_item_id
  await admin("POST", `/admin/inventory-items/${item}/location-levels`, { location_id: stores[0].default_location_id, stocked_quantity: 0 })
  await eventually("inventory 0 → Sold out", async () => (await page(url)).html.includes("Sold out"))
  await admin("POST", `/admin/inventory-items/${item}/location-levels/${stores[0].default_location_id}`, { stocked_quantity: 2 })
  await eventually("restock → Add to cart", async () => { const h = (await page(url)).html; return h.includes("Add to cart") && !h.includes(">Sold out<") })
  await admin("POST", `/admin/products/${productId}`, { status: "draft" })
  await eventually("unpublish → 404", async () => (await page(url)).status === 404)
  await admin("POST", `/admin/products/${productId}`, { status: "published" })
  await eventually("republish → 200", async () => (await page(url)).status === 200)
  await admin("DELETE", `/admin/products/${productId}`)
  productId = undefined
  await eventually("delete → 404", async () => (await page(url)).status === 404)
} finally {
  if (tempList) await admin("DELETE", `/admin/price-lists/${tempList}`).catch(() => {})
  if (productId) await admin("DELETE", `/admin/products/${productId}`).catch(() => {})
}
