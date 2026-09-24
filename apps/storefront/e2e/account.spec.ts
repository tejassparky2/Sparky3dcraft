import { expect, test } from "@playwright/test"
import { MAIL_DIR, addProductToCart, decodeQP, fillAddressAndShipping, uniqueEmail, waitForMail } from "./helpers"

test.describe("customer account", () => {
  test("register → account → order history → logout → login", async ({ page }) => {
    const email = uniqueEmail("acct")
    await page.goto("/register")
    await page.getByRole("main").getByLabel("First name").fill("Asha")
    await page.getByRole("main").getByLabel("Last name").fill("Rao")
    await page.getByRole("main").getByLabel("Email").fill(email)
    await page.getByRole("main").getByLabel(/Password/).fill("correct-horse-battery")
    await page.getByTestId("register-submit").click()
    await expect(page.getByTestId("account-email")).toContainText(email)

    await addProductToCart(page, "shiva-shadow-lamp")
    await fillAddressAndShipping(page, email)
    await page.getByRole("radio", { name: /Cash on Delivery/ }).check()
    await page.getByTestId("place-order").click()
    await expect(page.getByTestId("order-confirmed")).toBeVisible()
    const orderNo = (await page.getByTestId("order-number").textContent())!.trim()

    await page.goto("/account/orders")
    await expect(page.getByTestId("orders-table")).toContainText(orderNo)
    await page.getByRole("link", { name: orderNo }).click()
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`Order ${orderNo}`)

    await page.getByTestId("logout").click()
    await expect(page).toHaveURL(/\/$/)
    const r = await page.goto("/account")
    expect(page.url()).toContain("/login")
    expect(r?.status()).toBe(200)

    await page.getByRole("main").getByLabel("Email").fill(email)
    await page.getByRole("main").getByLabel("Password").fill("wrong-password")
    await page.getByTestId("login-submit").click()
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Incorrect email or password")
    await page.getByRole("main").getByLabel("Password").fill("correct-horse-battery")
    await page.getByTestId("login-submit").click()
    await expect(page.getByTestId("account-email")).toContainText(email)
  })

  test("another visitor cannot view someone else's order", async ({ page, browser }) => {
    const email = uniqueEmail("privacy")
    await addProductToCart(page, "shiva-shadow-lamp")
    await fillAddressAndShipping(page, email)
    await page.getByRole("radio", { name: /Cash on Delivery/ }).check()
    await page.getByTestId("place-order").click()
    await expect(page.getByTestId("order-confirmed")).toBeVisible()
    const url = page.url()
    const other = await browser.newContext()
    const p2 = await other.newPage()
    const r = await p2.goto(url)
    expect(r?.status()).toBe(404)
    await other.close()
  })

  test("existing email cannot be re-registered; password reset by email works", async ({ page }) => {
    test.skip(!MAIL_DIR, "E2E_MAIL_DIR not configured")
    const email = uniqueEmail("reset")
    await page.goto("/register")
    await page.getByRole("main").getByLabel("First name").fill("Ravi")
    await page.getByRole("main").getByLabel("Last name").fill("K")
    await page.getByRole("main").getByLabel("Email").fill(email)
    await page.getByRole("main").getByLabel(/Password/).fill("first-password-1")
    await page.getByTestId("register-submit").click()
    await expect(page.getByTestId("account-email")).toBeVisible()
    await page.getByTestId("logout").click()

    await page.goto("/register")
    await page.getByRole("main").getByLabel("First name").fill("Ravi")
    await page.getByRole("main").getByLabel("Last name").fill("K")
    await page.getByRole("main").getByLabel("Email").fill(email)
    await page.getByRole("main").getByLabel(/Password/).fill("another-password")
    await page.getByTestId("register-submit").click()
    await expect(page.getByRole("main").getByRole("alert")).toContainText("already exists")

    await page.goto("/forgot-password")
    await page.getByRole("main").getByLabel("Email").fill(email)
    await page.getByRole("button", { name: "Submit" }).click()
    await expect(page.getByRole("main").getByRole("status")).toContainText("If an account exists")
    const mail = decodeQP(await waitForMail(email, (raw) => raw.toLowerCase().includes("reset")))
    const link = /https?:\/\/[^\s"<>]+\/reset-password\?token=[^\s"<>]+/.exec(mail.replace(/&amp;/g, "&"))?.[0]
    expect(link).toBeTruthy()
    const u = new URL(link!)
    await page.goto(`/reset-password${u.search}`)
    await page.getByRole("main").getByLabel(/New password/).fill("second-password-2")
    await page.getByRole("main").getByLabel("Confirm password").fill("second-password-2")
    await page.getByRole("button", { name: "Reset password" }).click()
    await expect(page).toHaveURL(/\/login\?reset=1/)
    await page.getByRole("main").getByLabel("Email").fill(email)
    await page.getByRole("main").getByLabel("Password").fill("second-password-2")
    await page.getByTestId("login-submit").click()
    await expect(page.getByTestId("account-email")).toContainText(email)
    // token is single-use
    await page.getByTestId("logout").click()
    await page.goto(`/reset-password${u.search}`)
    await page.getByRole("main").getByLabel(/New password/).fill("third-password-3")
    await page.getByRole("main").getByLabel("Confirm password").fill("third-password-3")
    await page.getByRole("button", { name: "Reset password" }).click()
    await expect(page.getByRole("main").getByRole("alert")).toContainText("invalid or has expired")
  })

  test("unknown email on forgot-password gives the same neutral answer", async ({ page }) => {
    await page.goto("/forgot-password")
    await page.getByRole("main").getByLabel("Email").fill(uniqueEmail("nobody"))
    await page.getByRole("button", { name: "Submit" }).click()
    await expect(page.getByRole("main").getByRole("status")).toContainText("If an account exists")
  })
})

test.describe("contact & newsletter", () => {
  test("contact form stores the message and notifies the merchant", async ({ page }) => {
    await page.goto("/contact")
    const email = uniqueEmail("contact")
    await page.getByRole("main").getByLabel("Name").fill("QA Contact")
    await page.getByRole("main").getByLabel(/Email/).fill(email)
    await page.getByRole("main").getByLabel("Comment").fill("Do you ship to Mysuru?")
    await page.getByTestId("contact-submit").click()
    await expect(page.getByTestId("contact-success")).toBeVisible()
    if (MAIL_DIR) {
      const mail = await waitForMail("merchant@sparky.test", (raw) => raw.includes(email))
      expect(mail).toContain("Mysuru")
    }
  })

  test("newsletter signup", async ({ page }) => {
    await page.goto("/")
    await page.getByRole("textbox", { name: "Email", exact: true }).fill(uniqueEmail("news"))
    await page.getByRole("button", { name: "Subscribe" }).click()
    await expect(page.getByText("Thanks for subscribing")).toBeVisible()
  })
})
