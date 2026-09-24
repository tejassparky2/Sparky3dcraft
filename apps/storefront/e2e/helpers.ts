import fs from "node:fs"
import path from "node:path"
import { expect, type Page } from "@playwright/test"

export const MEDUSA = process.env.E2E_MEDUSA_URL || "http://127.0.0.1:9000"
export const RZP_FAKE = process.env.E2E_RZP_FAKE_URL || "http://127.0.0.1:9911"
export const MAIL_DIR = process.env.E2E_MAIL_DIR || ""
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL || "admin@sparky.test"
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || ""

export async function adminToken(): Promise<string> {
  const res = await fetch(`${MEDUSA}/auth/user/emailpass`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  })
  const d = await res.json()
  if (!d.token) throw new Error("admin login failed (set E2E_ADMIN_PASSWORD)")
  return d.token
}

export async function admin<T = any>(token: string, method: string, p: string, body?: unknown): Promise<T> {
  const res = await fetch(`${MEDUSA}${p}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : ({} as T)
}

export async function rzpMode(mode: { outcome: "captured" | "authorized" | "failed" | "dismiss"; webhook?: boolean }) {
  await fetch(`${RZP_FAKE}/__test/mode`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ webhook: true, ...mode }) })
}

export async function rzpState(): Promise<any> {
  return (await fetch(`${RZP_FAKE}/__test/state`)).json()
}

export function uniqueEmail(tag: string) {
  return `e2e+${tag}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.com`
}

export async function addProductToCart(page: Page, handle: string) {
  await page.goto(`/products/${handle}`)
  await page.getByTestId("add-to-cart").click()
  await expect(page.getByTestId("cart-notification")).toBeVisible()
}

export async function fillAddressAndShipping(page: Page, email: string) {
  await page.goto("/checkout")
  await page.getByRole("main").getByLabel("Email").fill(email)
  await page.getByRole("main").getByLabel("First name").fill("Test")
  await page.getByRole("main").getByLabel("Last name").fill("Customer")
  await page.getByRole("main").getByLabel("Address", { exact: false }).first().fill("12 MG Road")
  await page.getByRole("main").getByLabel("City").fill("Bengaluru")
  await page.getByRole("main").getByLabel("State").selectOption("Karnataka")
  await page.getByRole("main").getByLabel("PIN code").fill("560001")
  await page.getByRole("main").getByLabel("Mobile number").fill("9876543210")
  await page.getByTestId("continue-to-shipping").click()
  await expect(page.getByTestId("continue-to-payment")).toBeVisible()
  await page.getByTestId("continue-to-payment").click()
  await expect(page.getByTestId("place-order")).toBeVisible()
}

/** Latest captured email to `to`, waiting up to timeoutMs. */
export async function waitForMail(to: string, predicate: (raw: string) => boolean, timeoutMs = 20000): Promise<string> {
  if (!MAIL_DIR) throw new Error("E2E_MAIL_DIR not set")
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const files = fs.existsSync(MAIL_DIR) ? fs.readdirSync(MAIL_DIR).sort().reverse() : []
    for (const f of files) {
      const raw = fs.readFileSync(path.join(MAIL_DIR, f), "utf8")
      if (raw.includes(`X-Capture-To: <${to}>`) && predicate(raw)) return raw
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`no email to ${to} within ${timeoutMs}ms`)
}

/** Decode quoted-printable body (nodemailer default for html/text parts). */
export function decodeQP(s: string) {
  return s.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}
