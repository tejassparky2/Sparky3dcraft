import { expect, test } from "@playwright/test"
import { MEDUSA, RZP_FAKE, decodeQP, addProductToCart, admin, adminToken, fillAddressAndShipping, rzpMode, rzpState, uniqueEmail, waitForMail, MAIL_DIR } from "./helpers"

async function ordersByEmail(token: string, email: string) {
  const { orders } = await admin<{ orders: any[] }>(token, "GET", `/admin/orders?q=${encodeURIComponent(email)}&fields=id,display_id,email,status,payment_status,total,*items,+items.metadata,*payment_collections.payments`)
  return orders.filter((o) => o.email === email)
}

test.describe("checkout", () => {
  let token: string
  test.beforeAll(async () => {
    token = await adminToken()
  })

  test("COD: order placed, payment authorized (not captured), email sent, visible in Admin", async ({ page }) => {
    const email = uniqueEmail("cod")
    await addProductToCart(page, "rayara-mantrakshate-ring") // Rs 699 → below free-shipping threshold
    await fillAddressAndShipping(page, email)
    await expect(page.getByTestId("summary-shipping")).toHaveText("Rs. 79.00 INR")
    await expect(page.getByTestId("summary-total")).toHaveText("Rs. 778.00 INR")
    await page.getByRole("radio", { name: /Cash on Delivery/ }).check()
    await page.getByTestId("place-order").click()
    await expect(page.getByTestId("order-confirmed")).toBeVisible()
    await expect(page.getByTestId("payment-label")).toContainText("Cash on Delivery")
    await expect(page.getByTestId("order-total")).toHaveText("Rs. 778.00 INR")
    const orders = await ordersByEmail(token, email)
    expect(orders).toHaveLength(1)
    expect(orders[0].payment_status).toBe("authorized")
    expect(orders[0].payment_collections[0].payments[0].provider_id).toBe("pp_cod_cod")
    // the cart is gone: going back does not allow re-submitting
    await page.goto("/checkout")
    await expect(page).toHaveURL(/\/cart$/)
    if (MAIL_DIR) {
      const mail = decodeQP(await waitForMail(email, (raw) => decodeQP(raw).includes("Thank you for your order")))
      expect(mail).toContain("Cash on Delivery")
      expect(mail).toContain("Rs. 778.00 INR")
    }
  })

  test("Razorpay success: order created only after server-side verification; payment captured", async ({ page }) => {
    await rzpMode({ outcome: "captured", webhook: true })
    const email = uniqueEmail("rzp")
    await addProductToCart(page, "shiva-shadow-lamp") // Rs 999 → free shipping in test config
    await fillAddressAndShipping(page, email)
    await expect(page.getByTestId("summary-shipping")).toHaveText("Rs. 0.00 INR")
    await page.getByRole("radio", { name: /Razorpay/ }).check()
    await page.getByTestId("place-order").click()
    await expect(page.getByTestId("order-confirmed")).toBeVisible()
    await expect(page.getByTestId("payment-label")).toContainText("Razorpay")
    const orders = await ordersByEmail(token, email)
    expect(orders).toHaveLength(1)
    expect(orders[0].payment_status).toBe("captured")
    const st = await rzpState()
    const rzpOrder = Object.values<any>(st.orders).find((o) => o.amount === 99900 && o.status === "paid")
    expect(rzpOrder).toBeTruthy()
    // webhook for the same payment arrives afterwards → must not create a second order
    await page.waitForTimeout(8000)
    expect(await ordersByEmail(token, email)).toHaveLength(1)
  })

  test("Razorpay cancelled then retried: exactly one order", async ({ page }) => {
    await rzpMode({ outcome: "dismiss" })
    const email = uniqueEmail("rzp-retry")
    await addProductToCart(page, "krishna-rayaru")
    await fillAddressAndShipping(page, email)
    await page.getByRole("radio", { name: /Razorpay/ }).check()
    await page.getByTestId("place-order").click()
    await expect(page.getByTestId("checkout-info")).toContainText("Payment was cancelled")
    expect(await ordersByEmail(token, email)).toHaveLength(0)
    await rzpMode({ outcome: "captured", webhook: false })
    await page.getByTestId("place-order").click()
    await expect(page.getByTestId("order-confirmed")).toBeVisible()
    expect(await ordersByEmail(token, email)).toHaveLength(1)
  })

  test("Razorpay failure shows an error and creates no order", async ({ page }) => {
    await rzpMode({ outcome: "failed", webhook: true })
    const email = uniqueEmail("rzp-fail")
    await addProductToCart(page, "vene-rayaru")
    await fillAddressAndShipping(page, email)
    await page.getByRole("radio", { name: /Razorpay/ }).check()
    await page.getByTestId("place-order").click()
    await expect(page.getByTestId("checkout-error")).toContainText("Payment failed")
    await page.waitForTimeout(7000) // failed-payment webhook processed
    expect(await ordersByEmail(token, email)).toHaveLength(0)
    await rzpMode({ outcome: "captured", webhook: true })
  })

  test("double submission creates one order", async ({ page }) => {
    const email = uniqueEmail("double")
    await addProductToCart(page, "cute-little-bene-krishna")
    await fillAddressAndShipping(page, email)
    await page.getByRole("radio", { name: /Cash on Delivery/ }).check()
    // Two clicks in the same event-loop tick (faster than any human double-click).
    await page.getByTestId("place-order").evaluate((el: HTMLElement) => {
      el.click()
      el.click()
    })
    await expect(page.getByTestId("order-confirmed")).toBeVisible()
    await page.waitForTimeout(2000)
    expect(await ordersByEmail(token, email)).toHaveLength(1)
  })

  test("personalized item: photo + colour reach the order (Admin can fetch the photo)", async ({ page }) => {
    const email = uniqueEmail("perso")
    await page.goto("/products/customized-lithophane-lamp")
    await page.getByTestId("photo-input").setInputFiles(require("node:path").join(__dirname, "fixtures", "photo.jpg"))
    await expect(page.getByText("photo.jpg")).toBeVisible()
    await page.getByRole("radio", { name: "WHITE" }).check({ force: true })
    await page.getByTestId("add-to-cart").click()
    await expect(page.getByTestId("cart-notification")).toBeVisible()
    await fillAddressAndShipping(page, email)
    await page.getByRole("radio", { name: /Cash on Delivery/ }).check()
    await page.getByTestId("place-order").click()
    await expect(page.getByTestId("order-confirmed")).toContainText("Color: WHITE")
    const [order] = await ordersByEmail(token, email)
    const meta = order.items[0].metadata
    expect(meta.choice_value).toBe("WHITE")
    expect(meta.photo_upload_id).toMatch(/^cupl_/)
    const img = await fetch(`${MEDUSA}/admin/sparky/uploads/${meta.photo_upload_id}`, { headers: { authorization: `Bearer ${token}` } })
    expect(img.status).toBe(200)
    expect(img.headers.get("content-type")).toBe("image/jpeg")
    const anon = await fetch(`${MEDUSA}/admin/sparky/uploads/${meta.photo_upload_id}`)
    expect(anon.status).toBe(401)
  })
})

test.describe("payment webhooks (API level)", () => {
  test("customer pays but never returns: webhook completes the cart exactly once; duplicates and forgeries are rejected", async ({ request }) => {
    await rzpMode({ outcome: "captured", webhook: false })
    const token = await adminToken()
    const pk = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || process.env.E2E_PUBLISHABLE_KEY || ""
    expect(pk).not.toBe("")
    const h = { "x-publishable-api-key": pk, "content-type": "application/json" }
    const j = async (method: string, p: string, body?: unknown) => {
      const r = await fetch(`${MEDUSA}${p}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
      const t = await r.json()
      if (!r.ok) throw new Error(`${p}: ${JSON.stringify(t)}`)
      return t
    }
    const { regions } = await j("GET", "/store/regions")
    const { products } = await j("GET", `/store/products?handle=rayaru-with-brundavana&region_id=${regions[0].id}`)
    const email = uniqueEmail("webhook")
    const { cart } = await j("POST", "/store/carts", { region_id: regions[0].id, email })
    await j("POST", `/store/carts/${cart.id}/line-items`, { variant_id: products[0].variants[0].id, quantity: 1 })
    const addr = { first_name: "Web", last_name: "Hook", address_1: "1 Test Rd", city: "Bengaluru", province: "Karnataka", postal_code: "560001", country_code: "in", phone: "9876543210" }
    await j("POST", `/store/carts/${cart.id}`, { shipping_address: addr, billing_address: addr })
    const { shipping_options } = await j("GET", `/store/shipping-options?cart_id=${cart.id}`)
    await j("POST", `/store/carts/${cart.id}/shipping-methods`, { option_id: shipping_options[0].id })
    const { payment_collection } = await j("POST", "/store/payment-collections", { cart_id: cart.id })
    const pc = await j("POST", `/store/payment-collections/${payment_collection.id}/payment-sessions`, { provider_id: "pp_razorpay_razorpay" })
    const session = pc.payment_collection.payment_sessions[0]
    expect(session.data.key_id).toBe("rzp_test_fake")
    expect(JSON.stringify(session.data)).not.toContain("fake_key_secret")

    // Forged webhook (wrong signature) is rejected before anything happens.
    const forged = await request.post(`${MEDUSA}/hooks/razorpay`, {
      headers: { "x-razorpay-signature": "0".repeat(64), "x-razorpay-event-id": "evt_forged", "content-type": "application/json" },
      data: { event: "payment.captured", payload: { payment: { entity: { id: "pay_x", amount: 1, notes: { session_id: session.id } } } } },
    })
    expect(forged.status()).toBe(400)

    // Customer pays in the Razorpay window, then closes the browser.
    const pay = await (await fetch(`${RZP_FAKE}/__test/pay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order_id: session.data.razorpay_order_id }) })).json()
    expect(pay.status).toBe("captured")
    const hook = await (await fetch(`${RZP_FAKE}/__test/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payment_id: pay.id, event: "payment.captured" }) })).json()
    expect(hook.status).toBe(200)

    // Worker completes the cart (Medusa delays webhook processing ~5s).
    let found: any[] = []
    for (let i = 0; i < 30 && !found.length; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      found = (await admin<{ orders: any[] }>(token, "GET", `/admin/orders?q=${encodeURIComponent(email)}&fields=id,email,payment_status`)).orders.filter((o) => o.email === email)
    }
    expect(found).toHaveLength(1)
    expect(found[0].payment_status).toBe("captured")

    // Exact redelivery of the same event → acknowledged as duplicate, not reprocessed.
    const replay = await request.post(`${MEDUSA}/hooks/razorpay`, {
      headers: { "x-razorpay-signature": hook.sig, "x-razorpay-event-id": hook.eventId, "content-type": "application/json" },
      data: hook.body,
    })
    expect(replay.status()).toBe(200)
    expect(await replay.json()).toMatchObject({ duplicate: true })

    // A NEW event for the same payment (Razorpay retry with new id) → still one order.
    await fetch(`${RZP_FAKE}/__test/webhook`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ payment_id: pay.id, event: "order.paid" }) })
    await new Promise((r) => setTimeout(r, 8000))
    const after = (await admin<{ orders: any[] }>(token, "GET", `/admin/orders?q=${encodeURIComponent(email)}&fields=id,email`)).orders.filter((o) => o.email === email)
    expect(after).toHaveLength(1)
    // Completing the cart again from the browser (e.g. user returns) is idempotent.
    const again = await fetch(`${MEDUSA}/store/carts/${cart.id}/complete`, { method: "POST", headers: h })
    const againBody = await again.json()
    expect(againBody.type === "order" ? againBody.order.id : null).toBe(found[0].id)
  })
})

test.describe("cart completion concurrency (API level)", () => {
  test("5 concurrent completes of one COD cart → one order", async () => {
    const token = await adminToken()
    const pk = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY || process.env.E2E_PUBLISHABLE_KEY || ""
    const h = { "x-publishable-api-key": pk, "content-type": "application/json" }
    const j = async (method: string, p: string, body?: unknown) => {
      const r = await fetch(`${MEDUSA}${p}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined })
      return r.json()
    }
    const { regions } = await j("GET", "/store/regions")
    const { products } = await j("GET", `/store/products?handle=shiva-shadow-lamp&region_id=${regions[0].id}`)
    const email = uniqueEmail("concurrent")
    const { cart } = await j("POST", "/store/carts", { region_id: regions[0].id, email })
    await j("POST", `/store/carts/${cart.id}/line-items`, { variant_id: products[0].variants[0].id, quantity: 1 })
    const addr = { first_name: "Con", last_name: "Current", address_1: "1 Test Rd", city: "Bengaluru", province: "Karnataka", postal_code: "560001", country_code: "in", phone: "9876543210" }
    await j("POST", `/store/carts/${cart.id}`, { shipping_address: addr, billing_address: addr })
    const { shipping_options } = await j("GET", `/store/shipping-options?cart_id=${cart.id}`)
    await j("POST", `/store/carts/${cart.id}/shipping-methods`, { option_id: shipping_options[0].id })
    const { payment_collection } = await j("POST", "/store/payment-collections", { cart_id: cart.id })
    await j("POST", `/store/payment-collections/${payment_collection.id}/payment-sessions`, { provider_id: "pp_cod_cod" })
    const results = await Promise.all(Array.from({ length: 5 }, () => j("POST", `/store/carts/${cart.id}/complete`)))
    const orderIds = new Set(results.filter((r) => r.type === "order").map((r) => r.order.id))
    expect(orderIds.size).toBe(1)
    const { orders } = await admin<{ orders: any[] }>(token, "GET", `/admin/orders?q=${encodeURIComponent(email)}&fields=id,email`)
    expect(orders.filter((o) => o.email === email)).toHaveLength(1)
  })
})
