import { expect, test } from "@playwright/test"

test.describe("browse, search, SEO", () => {
  test("home renders live catalog data with no console errors", async ({ page }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(e.message))
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()))
    await page.goto("/")
    await expect(page.getByRole("heading", { name: "Browse our latest products" })).toBeVisible()
    await expect(page.getByRole("link", { name: /Personalized Gifts/ })).toBeVisible()
    await expect(page.getByRole("link", { name: /Rayara Idols/ })).toBeVisible()
    // featured = Rayara Idols in the collection's manual order (as on the live site)
    const titles = await page.locator(".grid .card__title").allTextContents()
    expect(titles.map((t) => t.trim())).toEqual(["Guru Raghavendra Swamy", "Krishna Rayaru", "Vene Rayaru", "Rayara Mantrakshate Ring"])
    await expect(page.locator(".grid .badge").first()).toHaveText("Sale")
    expect(errors).toEqual([])
  })

  test("catalog lists every product, sorts and filters", async ({ page }) => {
    await page.goto("/catalog")
    await expect(page.locator(".grid > li")).toHaveCount(9)
    await page.goto("/catalog?sort=price-descending")
    await expect(page.locator(".grid .card__title").first()).toHaveText("Rayaru With Brundavana")
    await page.goto("/catalog?sort=price-ascending")
    await expect(page.locator(".grid .card__title").first()).toHaveText("Rayara Mantrakshate Ring")
    await page.goto("/catalog?min=1000")
    await expect(page.locator(".grid > li")).toHaveCount(1)
    await page.goto("/catalog?availability=out")
    await expect(page.getByText("No products found")).toBeVisible()
  })

  test("collection pages and 404s", async ({ page }) => {
    await page.goto("/collections/customized-gifts")
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Personalized Gifts")
    await expect(page.locator(".grid > li")).toHaveCount(2)
    const r = await page.goto("/collections/does-not-exist")
    expect(r?.status()).toBe(404)
    const r2 = await page.goto("/products/does-not-exist")
    expect(r2?.status()).toBe(404)
  })

  test("search: exact, partial, case-insensitive, none, special characters, empty", async ({ page }) => {
    await page.goto("/search?q=Shiva%20Shadow%20Lamp")
    await expect(page.locator(".grid .card__title")).toHaveText(["Shiva Shadow Lamp"])
    await page.goto("/search?q=krish")
    expect(await page.locator(".grid > li").count()).toBeGreaterThanOrEqual(2)
    await page.goto("/search?q=KRISHNA")
    expect(await page.locator(".grid > li").count()).toBeGreaterThanOrEqual(2)
    await page.goto("/search?q=zzzznotaproduct")
    await expect(page.getByText("No products found")).toBeVisible()
    let dialog = false
    page.on("dialog", async (d) => {
      dialog = true
      await d.dismiss()
    })
    const r = await page.goto("/search?q=%27%22%3Cscript%3Ealert(1)%3C%2Fscript%3E%25%3B--")
    expect(r?.status()).toBe(200)
    // rendered as inert text, never as markup
    await expect(page.getByText("0 results for")).toContainText("<script>alert(1)</script>")
    expect(await page.locator("main script").count()).toBe(0)
    expect(dialog).toBe(false)
    await page.goto("/search")
    await expect(page.getByText("Enter a search term")).toBeVisible()
  })

  test("predictive search modal", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("button", { name: "Search" }).first().click()
    await page.getByRole("searchbox").fill("lamp")
    await expect(page.locator(".search-results li")).not.toHaveCount(0)
    await page.keyboard.press("Enter")
    await expect(page).toHaveURL(/\/search\?q=lamp/)
  })

  test("product SEO: canonical, OpenGraph, Product + Breadcrumb JSON-LD", async ({ page }) => {
    await page.goto("/products/shiva-shadow-lamp")
    await expect(page).toHaveTitle("Shiva Shadow Lamp – SPARKY 3D CRAFT CO")
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href")
    expect(canonical).toMatch(/\/products\/shiva-shadow-lamp$/)
    expect(await page.locator('meta[property="og:image"]').first().getAttribute("content")).toBeTruthy()
    const ld = await page.locator('script[type="application/ld+json"]').allTextContents()
    const product = ld.map((s) => JSON.parse(s)).find((x) => x["@type"] === "Product")
    expect(product.offers.price).toBe("999.00")
    expect(product.offers.priceCurrency).toBe("INR")
    expect(product.offers.availability).toBe("https://schema.org/InStock")
    expect(ld.map((s) => JSON.parse(s)).some((x) => x["@type"] === "BreadcrumbList")).toBe(true)
    const robots = await page.locator('meta[name="robots"]').getAttribute("content")
    expect(robots ?? "index").not.toContain("noindex")
  })

  test("personalized product SEO title comes from migrated product metadata when present", async ({ page }) => {
    await page.goto("/products/customized-lithophane-lamp")
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Customized Lithophane Lamp")
    await expect(page.getByText("Taxes included.")).toBeVisible()
  })

  test("sitemap, robots and old-URL redirects", async ({ request }) => {
    const sm = await (await request.get("/sitemap.xml")).text()
    expect(sm).toContain("/products/customized-lithophane-lamp")
    expect(sm).toContain("/collections/customized-idols")
    const robots = await (await request.get("/robots.txt")).text()
    expect(robots).toContain("Sitemap:")
    expect(robots).toContain("Disallow: /checkout")
    for (const [from, to] of [
      ["/collections/all", "/catalog"],
      ["/pages/contact", "/contact"],
      ["/policies/privacy-policy", "/privacy"],
      ["/account/login", "/login"],
    ]) {
      const r = await request.get(from, { maxRedirects: 0 })
      expect([301, 308]).toContain(r.status())
      expect(r.headers()["location"]).toContain(to)
    }
  })

  test("video media is shown for products that have it", async ({ page }) => {
    await page.goto("/products/raghavendra-swamy")
    await expect(page.locator(".gallery video")).toHaveCount(2)
  })
})
