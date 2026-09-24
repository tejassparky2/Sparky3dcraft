import path from "node:path"
import { expect, test } from "@playwright/test"
import { addProductToCart } from "./helpers"

test.describe("cart", () => {
  test("empty cart page", async ({ page }) => {
    await page.goto("/cart")
    await expect(page.getByTestId("cart-empty")).toBeVisible()
    await expect(page.getByText("Your cart is empty")).toBeVisible()
  })

  test("add, change quantity, remove", async ({ page }) => {
    await addProductToCart(page, "shiva-shadow-lamp")
    await expect(page.getByTestId("cart-count")).toHaveText("1")
    await page.goto("/cart")
    await expect(page.getByTestId("cart-line")).toHaveCount(1)
    await expect(page.getByTestId("cart-total")).toHaveText("Rs. 999.00 INR")
    await page.getByRole("button", { name: /Increase quantity/ }).click()
    await expect(page.getByTestId("cart-total")).toHaveText("Rs. 1,998.00 INR")
    await page.getByRole("button", { name: /Decrease quantity/ }).click()
    await expect(page.getByTestId("cart-total")).toHaveText("Rs. 999.00 INR")
    await page.getByRole("button", { name: /Remove/ }).click()
    await expect(page.getByTestId("cart-empty")).toBeVisible()
  })

  test("personalized product requires photo and colour (enforced client and server side)", async ({ page }) => {
    await page.goto("/products/customized-lithophane-lamp")
    await expect(page.getByTestId("buy-now")).toHaveCount(0) // as on the live site
    await page.getByTestId("add-to-cart").click()
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Upload Your Custom Photo is required")
    await page.getByTestId("photo-input").setInputFiles(path.join(__dirname, "fixtures", "photo.jpg"))
    await expect(page.getByText("photo.jpg")).toBeVisible()
    await page.getByTestId("add-to-cart").click()
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Please choose a Color")
    await page.getByRole("radio", { name: "GOLD" }).check({ force: true })
    await page.getByTestId("add-to-cart").click()
    await expect(page.getByTestId("cart-notification")).toContainText("Color: GOLD")
    await page.goto("/cart")
    await expect(page.getByTestId("cart-line")).toContainText("Color: GOLD")
    await expect(page.getByTestId("cart-line")).toContainText("Photo: photo.jpg")
  })

  test("rejects a non-image upload", async ({ page }) => {
    await page.goto("/products/customized-lithophane-lamp")
    await page.getByTestId("photo-input").setInputFiles({ name: "evil.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<html><script>alert(1)</script></html>") })
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Please upload a JPG, PNG, WEBP or HEIC photo")
  })
})
