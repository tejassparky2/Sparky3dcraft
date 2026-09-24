import { expect, test } from "@playwright/test"

test.describe("mobile", () => {
  test("drawer navigation, product slider, no horizontal scroll", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "Menu" }).click()
    const drawer = page.getByRole("dialog", { name: "Menu" })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole("link", { name: "Log in" })).toBeVisible()
    await drawer.getByRole("link", { name: "Catalog" }).click()
    await expect(page).toHaveURL(/\/catalog$/)
    await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await page.goto("/products/raghavendra-swamy")
    await expect(page.locator(".slider__controls")).toContainText("1 / 4")
    await page.getByRole("button", { name: "Next slide" }).click()
    await expect(page.locator(".slider__controls")).toContainText("2 / 4")
  })

  test("checkout form is usable on mobile", async ({ page }) => {
    await page.goto("/products/shiva-shadow-lamp")
    await page.getByTestId("add-to-cart").click()
    await expect(page.getByTestId("cart-count")).toHaveText("1")
    await page.goto("/checkout")
    await expect(page.getByRole("main").getByLabel("PIN code")).toBeVisible()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
  })
})
