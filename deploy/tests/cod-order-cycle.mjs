// Places a real COD order through the Store API, verifies it in Admin
// (payment authorized, not captured), then CANCELS it so no stray order remains.
import { adminSession, env } from "./lib.mjs"

const API = env("API_URL"), PK = env("PK")
const admin = await adminSession(API, env("ADMIN_EMAIL"), env("ADMIN_PASSWORD"))
const h = { "x-publishable-api-key": PK, "content-type": "application/json" }
const store = async (m, p, b) => {
  const r = await fetch(`${API}${p}`, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined })
  const d = await r.json()
  if (!r.ok) throw new Error(`${p}: ${JSON.stringify(d).slice(0, 200)}`)
  return d
}
const { regions } = await store("GET", "/store/regions")
const { products } = await store("GET", `/store/products?region_id=${regions[0].id}&limit=50&fields=id,metadata,variants.id,variants.manage_inventory`)
const p = products.find((x) => !(x.metadata?.personalization_photo))
if (!p) throw new Error("no non-personalized product to order")
const email = `verification+${Date.now()}@example.com`
const { cart } = await store("POST", "/store/carts", { region_id: regions[0].id, email })
await store("POST", `/store/carts/${cart.id}/line-items`, { variant_id: p.variants[0].id, quantity: 1 })
const addr = { first_name: "Verification", last_name: "Order", address_1: "Do not ship", city: "Bengaluru", province: "Karnataka", postal_code: "560001", country_code: "in", phone: "9000000000" }
await store("POST", `/store/carts/${cart.id}`, { shipping_address: addr, billing_address: addr })
const { shipping_options } = await store("GET", `/store/shipping-options?cart_id=${cart.id}`)
await store("POST", `/store/carts/${cart.id}/shipping-methods`, { option_id: shipping_options[0].id })
const { payment_collection } = await store("POST", "/store/payment-collections", { cart_id: cart.id })
await store("POST", `/store/payment-collections/${payment_collection.id}/payment-sessions`, { provider_id: "pp_cod_cod" })
const done = await store("POST", `/store/carts/${cart.id}/complete`)
if (done.type !== "order") throw new Error("cart did not complete")
const { order } = await admin("GET", `/admin/orders/${done.order.id}?fields=id,display_id,payment_status,status`)
console.log(`ok   order #${order.display_id} visible in Admin, payment_status=${order.payment_status}`)
if (order.payment_status !== "authorized") throw new Error("COD order should be authorized (not captured)")
await admin("POST", `/admin/orders/${order.id}/cancel`)
console.log(`ok   verification order #${order.display_id} cancelled`)
