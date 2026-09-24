import crypto from "node:crypto"
import {
  fromMinorUnits,
  headerValue,
  safeEqualHex,
  toMinorUnits,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "../utils"

describe("razorpay utils", () => {
  it("converts major → minor units without float error", () => {
    expect(toMinorUnits(999, "inr")).toBe(99900)
    expect(toMinorUnits("999.00", "INR")).toBe(99900)
    expect(toMinorUnits("0.1", "inr")).toBe(10)
    expect(toMinorUnits(1.005, "inr")).toBe(101) // half-up on third decimal
    expect(toMinorUnits(19.99, "inr")).toBe(1999)
    expect(toMinorUnits({ raw: { value: "1299.5" } }, "inr")).toBe(129950)
    expect(toMinorUnits({ numeric: 79, raw: { value: "79" } }, "inr")).toBe(7900)
  })
  it("rejects invalid or unsupported amounts", () => {
    expect(() => toMinorUnits(-1, "inr")).toThrow()
    expect(() => toMinorUnits("abc", "inr")).toThrow()
    expect(() => toMinorUnits(NaN, "inr")).toThrow()
    expect(() => toMinorUnits(100, "jpy")).toThrow(/Unsupported currency/)
  })
  it("converts minor → major", () => {
    expect(fromMinorUnits(99900)).toBe(999)
    expect(fromMinorUnits(129950)).toBe(1299.5)
  })
  it("verifies webhook signatures (HMAC-SHA256 hex of raw body)", () => {
    const secret = "whsec_test_123"
    const body = Buffer.from(JSON.stringify({ event: "payment.captured" }))
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex")
    expect(verifyWebhookSignature(body, sig, secret)).toBe(true)
    expect(verifyWebhookSignature(body.toString("utf8"), sig, secret)).toBe(true)
    expect(verifyWebhookSignature(Buffer.from(body.toString() + " "), sig, secret)).toBe(false)
    expect(verifyWebhookSignature(body, sig, "other")).toBe(false)
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false)
    expect(verifyWebhookSignature(body, sig, undefined)).toBe(false)
    expect(verifyWebhookSignature(body, "zz" + sig.slice(2), secret)).toBe(false)
  })
  it("verifies checkout signatures (order_id|payment_id with key secret)", () => {
    const sig = crypto.createHmac("sha256", "ks").update("order_1|pay_1").digest("hex")
    expect(verifyCheckoutSignature("order_1", "pay_1", sig, "ks")).toBe(true)
    expect(verifyCheckoutSignature("order_1", "pay_2", sig, "ks")).toBe(false)
  })
  it("constant-time compare rejects malformed input", () => {
    expect(safeEqualHex("ab", "abc")).toBe(false)
    expect(safeEqualHex("zz", "zz")).toBe(false)
    expect(safeEqualHex("", "")).toBe(false)
  })
  it("reads headers case-insensitively", () => {
    expect(headerValue({ "X-Razorpay-Signature": "a" }, "x-razorpay-signature")).toBe("a")
    expect(headerValue({ "x-razorpay-signature": ["b"] }, "X-Razorpay-Signature")).toBe("b")
    expect(headerValue(undefined, "x")).toBeUndefined()
  })
})
