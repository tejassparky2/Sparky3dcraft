import crypto from "node:crypto"
import RazorpayProviderService from "../service"

type Store = { orders: Record<string, any>; payments: Record<string, any>; refunds: any[]; calls: string[] }

function fakeFetch(store: Store): typeof fetch {
  let n = 0
  return (async (url: any, init: any = {}) => {
    const u = new URL(String(url))
    const path = u.pathname.replace(/^\/v1/, "")
    const method = init.method ?? "GET"
    store.calls.push(`${method} ${path}`)
    const body = init.body ? JSON.parse(init.body) : undefined
    const json = (status: number, obj: any) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } })
    let m: RegExpExecArray | null
    if (method === "POST" && path === "/orders") {
      const id = `order_${++n}`
      store.orders[id] = { id, entity: "order", amount: body.amount, currency: body.currency, receipt: body.receipt, notes: body.notes, status: "created", amount_paid: 0, amount_due: body.amount }
      return json(200, store.orders[id])
    }
    if ((m = /^\/orders\/([^/]+)\/payments$/.exec(path))) {
      return json(200, { entity: "collection", count: 0, items: Object.values(store.payments).filter((p) => p.order_id === m![1]) })
    }
    if ((m = /^\/orders\/([^/]+)$/.exec(path))) return store.orders[m[1]] ? json(200, store.orders[m[1]]) : json(400, { error: { description: "not found" } })
    if ((m = /^\/payments\/([^/]+)\/capture$/.exec(path))) {
      const p = store.payments[m[1]]
      if (p.status !== "authorized") return json(400, { error: { code: "BAD_REQUEST_ERROR", description: "already captured" } })
      p.status = "captured"; p.captured = true
      return json(200, p)
    }
    if ((m = /^\/payments\/([^/]+)\/refunds$/.exec(path))) return json(200, { entity: "collection", count: 0, items: store.refunds.filter((r) => r.payment_id === m![1]) })
    if ((m = /^\/payments\/([^/]+)\/refund$/.exec(path))) {
      const r = { id: `rfnd_${++n}`, entity: "refund", amount: body.amount, receipt: body.receipt, payment_id: m[1], status: "processed", currency: "INR", notes: {} }
      store.refunds.push(r)
      return json(200, r)
    }
    if ((m = /^\/payments\/([^/]+)$/.exec(path))) return json(200, store.payments[m[1]])
    return json(404, { error: { description: "no route" } })
  }) as any
}

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any

function makeProvider(store: Store, webhookSecret = "whsec") {
  const svc = new RazorpayProviderService({ logger } as any, { key_id: "rzp_test_k", key_secret: "ks", webhook_secret: webhookSecret, api_base: "http://fake/v1" })
  ;(svc as any).client_ = new (require("../client").RazorpayClient)({ keyId: "rzp_test_k", keySecret: "ks", apiBase: "http://fake/v1", fetchImpl: fakeFetch(store) })
  return svc
}

const newStore = (): Store => ({ orders: {}, payments: {}, refunds: [], calls: [] })

describe("RazorpayProviderService", () => {
  it("initiates a Razorpay order in paise with the session id in notes/receipt and no secret", async () => {
    const store = newStore()
    const svc = makeProvider(store)
    const res = await svc.initiatePayment({ amount: 1078, currency_code: "inr", data: { session_id: "payses_1" }, context: {} } as any)
    const o = Object.values(store.orders)[0]
    expect(o.amount).toBe(107800)
    expect(o.currency).toBe("INR")
    expect(o.receipt).toBe("payses_1")
    expect(o.notes.session_id).toBe("payses_1")
    expect(res.id).toBe(o.id)
    expect(res.data).toMatchObject({ razorpay_order_id: o.id, amount: 107800, key_id: "rzp_test_k", session_id: "payses_1" })
    expect(JSON.stringify(res.data)).not.toContain("ks")
  })

  it("does not trust client-supplied data: authorizes only if Razorpay reports a matching payment", async () => {
    const store = newStore()
    const svc = makeProvider(store)
    const { data } = await svc.initiatePayment({ amount: 999, currency_code: "inr", data: { session_id: "payses_2" } } as any)
    // client claims success but nothing was paid
    const pending = await svc.authorizePayment({ data: { ...data, razorpay_payment_id: "pay_fake", status: "captured" } } as any)
    expect(pending.status).toBe("pending")

    // wrong amount payment must not authorize
    store.payments["pay_small"] = { id: "pay_small", order_id: data!.razorpay_order_id, amount: 100, currency: "INR", status: "captured" }
    expect((await svc.authorizePayment({ data } as any)).status).toBe("pending")

    store.payments["pay_ok"] = { id: "pay_ok", order_id: data!.razorpay_order_id, amount: 99900, currency: "INR", status: "authorized" }
    const auth = await svc.authorizePayment({ data } as any)
    expect(auth.status).toBe("authorized")
    expect(auth.data!.razorpay_payment_id).toBe("pay_ok")

    store.payments["pay_ok"].status = "captured"
    expect((await svc.authorizePayment({ data } as any)).status).toBe("captured")
  })

  it("refuses an order belonging to another session", async () => {
    const store = newStore()
    const svc = makeProvider(store)
    const { data } = await svc.initiatePayment({ amount: 999, currency_code: "inr", data: { session_id: "payses_A" } } as any)
    const res = await svc.authorizePayment({ data: { ...data, session_id: "payses_B" } } as any)
    expect(res.status).toBe("error")
  })

  it("reports error when only failed attempts exist", async () => {
    const store = newStore()
    const svc = makeProvider(store)
    const { data } = await svc.initiatePayment({ amount: 999, currency_code: "inr", data: { session_id: "s" } } as any)
    store.payments["pay_f"] = { id: "pay_f", order_id: data!.razorpay_order_id, amount: 99900, currency: "INR", status: "failed" }
    expect((await svc.authorizePayment({ data } as any)).status).toBe("error")
  })

  it("captures once; a second capture is idempotent", async () => {
    const store = newStore()
    const svc = makeProvider(store)
    const { data } = await svc.initiatePayment({ amount: 999, currency_code: "inr", data: { session_id: "s" } } as any)
    store.payments["pay_c"] = { id: "pay_c", order_id: data!.razorpay_order_id, amount: 99900, currency: "INR", status: "authorized" }
    const auth = await svc.authorizePayment({ data } as any)
    const c1 = await svc.capturePayment({ data: auth.data } as any)
    const c2 = await svc.capturePayment({ data: auth.data } as any)
    expect(c1.data!.razorpay_status).toBe("captured")
    expect(c2.data!.razorpay_status).toBe("captured")
    expect(store.calls.filter((c) => c.endsWith("/capture")).length).toBe(1)
  })

  it("refund is idempotent per Medusa refund id", async () => {
    const store = newStore()
    const svc = makeProvider(store)
    const { data } = await svc.initiatePayment({ amount: 999, currency_code: "inr", data: { session_id: "s" } } as any)
    store.payments["pay_r"] = { id: "pay_r", order_id: data!.razorpay_order_id, amount: 99900, currency: "INR", status: "captured" }
    const auth = await svc.authorizePayment({ data } as any)
    await svc.refundPayment({ data: auth.data, amount: 500, context: { idempotency_key: "ref_1" } } as any)
    await svc.refundPayment({ data: auth.data, amount: 500, context: { idempotency_key: "ref_1" } } as any)
    expect(store.refunds.length).toBe(1)
    expect(store.refunds[0].amount).toBe(50000)
    await svc.refundPayment({ data: auth.data, amount: 100, context: { idempotency_key: "ref_2" } } as any)
    expect(store.refunds.length).toBe(2)
  })

  it("updatePayment creates a new order only if amount changed", async () => {
    const store = newStore()
    const svc = makeProvider(store)
    const { data } = await svc.initiatePayment({ amount: 999, currency_code: "inr", data: { session_id: "s" } } as any)
    const same = await svc.updatePayment({ data, amount: 999, currency_code: "inr" } as any)
    expect(same.data!.razorpay_order_id).toBe(data!.razorpay_order_id)
    const changed = await svc.updatePayment({ data, amount: 1098, currency_code: "inr" } as any)
    expect(changed.data!.razorpay_order_id).not.toBe(data!.razorpay_order_id)
    expect(changed.data!.amount).toBe(109800)
  })

  it("maps signed webhooks and ignores unsigned/forged ones", async () => {
    const store = newStore()
    const svc = makeProvider(store, "whsec")
    const body = { event: "payment.captured", payload: { payment: { entity: { id: "pay_w", amount: 99900, order_id: "order_x", notes: { session_id: "payses_w" } } } } }
    const raw = Buffer.from(JSON.stringify(body))
    const sig = crypto.createHmac("sha256", "whsec").update(raw).digest("hex")
    const ok = await svc.getWebhookActionAndData({ data: body, rawData: raw, headers: { "x-razorpay-signature": sig } } as any)
    expect(ok).toEqual({ action: "captured", data: { session_id: "payses_w", amount: 999 } })
    const forged = await svc.getWebhookActionAndData({ data: body, rawData: raw, headers: { "x-razorpay-signature": "00".repeat(32) } } as any)
    expect(forged.action).toBe("not_supported")
    const auth = await svc.getWebhookActionAndData({ data: { ...body, event: "payment.authorized" }, rawData: Buffer.from(JSON.stringify({ ...body, event: "payment.authorized" })), headers: { "x-razorpay-signature": crypto.createHmac("sha256", "whsec").update(JSON.stringify({ ...body, event: "payment.authorized" })).digest("hex") } } as any)
    expect(auth.action).toBe("authorized")
  })

  it("never throws raw provider errors with secrets", async () => {
    const svc = new RazorpayProviderService({ logger } as any, { key_id: "k", key_secret: "SUPERSECRETVALUE", api_base: "http://127.0.0.1:9/v1" })
    await expect(svc.initiatePayment({ amount: 999, currency_code: "inr", data: { session_id: "s" } } as any)).rejects.toThrow(/Payment provider error/)
    for (const call of [...logger.error.mock.calls]) expect(String(call[0])).not.toContain("SUPERSECRETVALUE")
  })
})
