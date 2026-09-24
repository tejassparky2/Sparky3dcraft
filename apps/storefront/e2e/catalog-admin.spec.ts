import { expect, test } from "@playwright/test"
import { MEDUSA, admin, adminToken } from "./helpers"

/**
 * §54: every catalog change is made in Medusa (Admin API — the same API the
 * Admin UI uses) and must show up on the storefront WITHOUT touching or
 * rebuilding storefront code.
 */
test.describe.serial("catalog managed in Medusa Admin", () => {
  let token: string
  let productId: string
  let variantId: string
  const handle = `e2e-test-product-${Date.now().toString(36)}`

  test.beforeAll(async () => {
    token = await adminToken()
  })

  test.afterAll(async () => {
    if (productId) await admin(token, "DELETE", `/admin/products/${productId}`).catch(() => {})
  })

  async function eventually(page: import("@playwright/test").Page, path: string, check: () => Promise<void>, seconds = 45) {
    const deadline = Date.now() + seconds * 1000
    let last: unknown
    while (Date.now() < deadline) {
      await page.goto(path)
      try {
        await check()
        return
      } catch (e) {
        last = e
        await page.waitForTimeout(2000)
      }
    }
    throw last
  }

  test("create + publish → visible", async ({ page }) => {
    const { stores } = await admin(token, "GET", "/admin/stores")
    const { shipping_profiles } = await admin(token, "GET", "/admin/shipping-profiles?type=default")
    const { product } = await admin(token, "POST", "/admin/products", {
      title: "E2E Test Lamp",
      handle,
      status: "published",
      description: "<p>Created by the E2E suite.</p>",
      options: [{ title: "Title", values: ["Default Title"] }],
      variants: [{ title: "Default Title", options: { Title: "Default Title" }, manage_inventory: false, prices: [{ currency_code: "inr", amount: 1234 }] }],
      sales_channels: [{ id: stores[0].default_sales_channel_id }],
      shipping_profile_id: shipping_profiles[0].id,
    })
    productId = product.id
    variantId = product.variants[0].id
    await eventually(page, `/products/${handle}`, async () => {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E Test Lamp")
      await expect(page.getByTestId("product-price")).toContainText("Rs. 1,234.00 INR")
    })
  })

  test("edit title → updated", async ({ page }) => {
    await admin(token, "POST", `/admin/products/${productId}`, { title: "E2E Test Lamp Renamed" })
    await eventually(page, `/products/${handle}`, async () => {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E Test Lamp Renamed")
    })
  })

  test("edit price → updated", async ({ page }) => {
    await admin(token, "POST", `/admin/products/${productId}/variants/${variantId}`, { prices: [{ currency_code: "inr", amount: 1500 }] })
    await eventually(page, `/products/${handle}`, async () => {
      await expect(page.getByTestId("product-price")).toContainText("Rs. 1,500.00 INR")
    })
  })

  test("sale / compare-at via price list → struck price + Sale badge", async ({ page }) => {
    const { price_lists } = await admin(token, "GET", "/admin/price-lists?q=Shopify")
    const list = price_lists.find((l: any) => l.title.includes("Sale prices"))
    expect(list).toBeTruthy()
    await admin(token, "POST", `/admin/price-lists/${list.id}/prices/batch`, { create: [{ variant_id: variantId, currency_code: "inr", amount: 1100 }] })
    await eventually(
      page,
      `/products/${handle}`,
      async () => {
        await expect(page.getByTestId("product-price")).toContainText("Rs. 1,500.00 INR")
        await expect(page.getByTestId("product-price")).toContainText("Rs. 1,100.00 INR")
        await expect(page.getByTestId("product-price").getByText("Sale", { exact: true })).toBeVisible()
      },
      75
    )
  })

  test("add image → shown", async ({ page }) => {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const form = new FormData()
    form.append("files", new Blob([fs.readFileSync(path.join(__dirname, "fixtures", "photo.jpg"))], { type: "image/jpeg" }), "e2e-lamp.jpg")
    const up = await fetch(`${MEDUSA}/admin/uploads`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form })
    const { files } = await up.json()
    await admin(token, "POST", `/admin/products/${productId}`, { images: [{ url: files[0].url }], thumbnail: files[0].url })
    await eventually(page, `/products/${handle}`, async () => {
      await expect(page.locator(".gallery img").first()).toBeVisible()
      const src = await page.locator(".gallery img").first().getAttribute("src")
      expect(src).toContain(encodeURIComponent("e2e-lamp").slice(0, 8))
    })
  })

  test("inventory 0 → sold out; restock → purchasable", async ({ page }) => {
    await admin(token, "POST", `/admin/products/${productId}/variants/${variantId}`, { manage_inventory: true })
    const { stores } = await admin(token, "GET", "/admin/stores")
    const { variant } = await admin(token, "GET", `/admin/products/${productId}/variants/${variantId}?fields=inventory_items.inventory_item_id`)
    const itemId = variant.inventory_items[0].inventory_item_id
    await admin(token, "POST", `/admin/inventory-items/${itemId}/location-levels`, { location_id: stores[0].default_location_id, stocked_quantity: 0 })
    await eventually(page, `/products/${handle}`, async () => {
      await expect(page.getByTestId("add-to-cart")).toHaveText("Sold out")
      await expect(page.getByTestId("add-to-cart")).toBeDisabled()
    })
    await admin(token, "POST", `/admin/inventory-items/${itemId}/location-levels/${stores[0].default_location_id}`, { stocked_quantity: 3 })
    await eventually(page, `/products/${handle}`, async () => {
      await expect(page.getByTestId("add-to-cart")).toHaveText("Add to cart")
    })
  })

  test("unpublish → not purchasable (404); republish → back", async ({ page }) => {
    await admin(token, "POST", `/admin/products/${productId}`, { status: "draft" })
    await eventually(page, `/products/${handle}`, async () => {
      await expect(page.getByTestId("not-found")).toBeVisible()
    })
    await admin(token, "POST", `/admin/products/${productId}`, { status: "published" })
    await eventually(page, `/products/${handle}`, async () => {
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("E2E Test Lamp Renamed")
    })
  })

  test("delete → gone from product page and catalog", async ({ page }) => {
    await admin(token, "DELETE", `/admin/products/${productId}`)
    productId = ""
    await eventually(page, `/products/${handle}`, async () => {
      await expect(page.getByTestId("not-found")).toBeVisible()
    })
    await eventually(page, "/catalog", async () => {
      await expect(page.locator(".grid > li")).toHaveCount(9)
    })
  })
})
