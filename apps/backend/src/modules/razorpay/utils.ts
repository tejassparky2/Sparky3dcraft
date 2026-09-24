import crypto from "node:crypto"

/** Currencies with exactly two minor-unit digits that Razorpay accepts. */
const TWO_DECIMAL = new Set(["inr", "usd", "eur", "gbp", "sgd", "aed", "aud", "cad"])

/**
 * Convert a Medusa amount (major units, e.g. 499.5 INR) to Razorpay's
 * smallest unit (paise). Works on the decimal string to avoid binary float
 * rounding (e.g. 1.005 * 100).
 */
export function toMinorUnits(amount: unknown, currency: string): number {
  if (!TWO_DECIMAL.has(currency.toLowerCase())) {
    throw new Error(`Unsupported currency for Razorpay provider: ${currency}`)
  }
  const raw = normalizeAmount(amount)
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(raw)
  if (!m) throw new Error(`Invalid amount: ${raw}`)
  const [, neg, whole, frac = ""] = m
  if (neg) throw new Error("Amount must not be negative")
  const padded = (frac + "000").slice(0, 3)
  let minor = Number(whole) * 100 + Number(padded.slice(0, 2))
  // round half up on the third decimal
  if (Number(padded[2]) >= 5) minor += 1
  if (!Number.isSafeInteger(minor)) throw new Error("Amount out of range")
  return minor
}

export function fromMinorUnits(minor: number): number {
  return Math.round(minor) / 100
}

function normalizeAmount(amount: unknown): string {
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) throw new Error("Invalid amount")
    return amount.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")
  }
  if (typeof amount === "string") return amount.trim()
  if (amount && typeof amount === "object") {
    const a = amount as Record<string, unknown>
    // Medusa BigNumber: { numeric, raw: { value } } or has toString / valueOf
    if (a.raw && typeof (a.raw as any).value === "string") return (a.raw as any).value
    if (typeof a.value === "string") return a.value
    if (typeof (a as any).numeric === "number") return normalizeAmount((a as any).numeric)
    const s = String(amount)
    if (s && s !== "[object Object]") return s
  }
  throw new Error("Invalid amount")
}

export function hmacSha256Hex(secret: string, payload: string | Buffer): string {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex")
}

export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false
  if (a.length !== b.length || !/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false
  return crypto.timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"))
}

/** Razorpay webhook: X-Razorpay-Signature = HMAC_SHA256(rawBody, webhookSecret). */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  signature: string | undefined,
  webhookSecret: string | undefined
): boolean {
  if (!webhookSecret || !signature) return false
  return safeEqualHex(hmacSha256Hex(webhookSecret, rawBody), signature)
}

/** Razorpay Checkout handler: signature = HMAC_SHA256(order_id|payment_id, keySecret). */
export function verifyCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string
): boolean {
  return safeEqualHex(hmacSha256Hex(keySecret, `${orderId}|${paymentId}`), signature)
}

export function headerValue(
  headers: Record<string, unknown> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined
  const lower = name.toLowerCase()
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) {
      if (Array.isArray(v)) return v[0] as string
      return typeof v === "string" ? v : undefined
    }
  }
  return undefined
}

export function notesOf(entity: { notes?: unknown } | undefined): Record<string, string> {
  const n = entity?.notes
  return n && typeof n === "object" && !Array.isArray(n) ? (n as Record<string, string>) : {}
}
