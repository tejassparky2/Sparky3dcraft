#!/usr/bin/env node
/**
 * Razorpay API TEST DOUBLE — for local/CI verification only.
 *
 * Implements the subset of https://api.razorpay.com/v1 used by
 * apps/backend/src/modules/razorpay (orders, order payments, payments,
 * capture, refunds) with Basic-auth checking, plus:
 *   GET  /checkout.js          stub of Razorpay Standard Checkout (window.Razorpay)
 *   POST /__test/mode          { outcome: "captured"|"authorized"|"failed"|"dismiss", webhook: bool }
 *   POST /__test/pay           simulate the customer paying an order
 *   POST /__test/webhook       send a signed webhook for a payment to Medusa
 *   GET  /__test/state         dump orders/payments/refunds
 *
 * It never talks to the real Razorpay. Env: PORT, RZP_KEY_ID, RZP_KEY_SECRET,
 * RZP_WEBHOOK_SECRET, MEDUSA_WEBHOOK_URL.
 */
import http from "node:http"
import crypto from "node:crypto"

const PORT = Number(process.env.PORT || 9911)
const KEY_ID = process.env.RZP_KEY_ID || "rzp_test_fake"
const KEY_SECRET = process.env.RZP_KEY_SECRET || "fake_key_secret"
const WEBHOOK_SECRET = process.env.RZP_WEBHOOK_SECRET || "fake_webhook_secret"
const WEBHOOK_URL = process.env.MEDUSA_WEBHOOK_URL || "http://127.0.0.1:9000/hooks/razorpay"

const state = { orders: {}, payments: {}, refunds: [], mode: { outcome: "captured", webhook: true }, webhooksSent: [] }
let seq = 0
const id = (p) => `${p}_${Date.now().toString(36)}${(++seq).toString(36).padStart(4, "0")}`

const json = (res, status, obj) => {
  res.writeHead(status, { "content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "content-type" })
  res.end(JSON.stringify(obj))
}
const readBody = (req) =>
  new Promise((resolve) => {
    let b = ""
    req.on("data", (c) => (b += c))
    req.on("end", () => {
      try {
        resolve(b ? JSON.parse(b) : {})
      } catch {
        resolve({})
      }
    })
  })

function authOk(req) {
  const h = req.headers.authorization || ""
  return h === "Basic " + Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")
}

async function sendWebhook(event, payment, order) {
  const body = JSON.stringify({
    entity: "event",
    account_id: "acc_fake",
    event,
    contains: order ? ["payment", "order"] : ["payment"],
    payload: { payment: { entity: payment }, ...(order ? { order: { entity: order } } : {}) },
    created_at: Math.floor(Date.now() / 1000),
  })
  const sig = crypto.createHmac("sha256", WEBHOOK_SECRET).update(body).digest("hex")
  const eventId = id("evt")
  const res = await fetch(WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": sig, "x-razorpay-event-id": eventId },
    body,
  }).catch((e) => ({ status: 0, statusText: e.message }))
  state.webhooksSent.push({ event, eventId, status: res.status })
  return { eventId, status: res.status, body, sig }
}

function pay(orderId, outcome) {
  const order = state.orders[orderId]
  if (!order) return null
  const p = {
    id: id("pay"),
    entity: "payment",
    amount: order.amount,
    currency: order.currency,
    status: outcome === "failed" ? "failed" : outcome === "authorized" ? "authorized" : "captured",
    order_id: order.id,
    method: "upi",
    captured: outcome === "captured",
    amount_refunded: 0,
    refund_status: null,
    notes: order.notes, // Razorpay Checkout passes order notes along (we also pass them explicitly)
    error_code: outcome === "failed" ? "BAD_REQUEST_ERROR" : null,
    error_description: outcome === "failed" ? "Payment failed (test double)" : null,
    created_at: Math.floor(Date.now() / 1000),
  }
  state.payments[p.id] = p
  if (p.status === "captured") {
    order.status = "paid"
    order.amount_paid = order.amount
    order.amount_due = 0
  } else order.status = "attempted"
  return p
}

const CHECKOUT_JS = `/* Razorpay Checkout TEST STUB */
(function(){
  var BASE = ${JSON.stringify(`http://127.0.0.1:${PORT}`)};
  function R(opts){ this.opts = opts; this.handlers = {}; }
  R.prototype.on = function(ev, cb){ this.handlers[ev] = cb; };
  R.prototype.open = function(){
    var self = this;
    fetch(BASE + '/__test/mode').then(function(r){return r.json()}).then(function(mode){
      if (mode.outcome === 'dismiss') { setTimeout(function(){ self.opts.modal && self.opts.modal.ondismiss && self.opts.modal.ondismiss(); }, 50); return; }
      return fetch(BASE + '/__test/pay', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({order_id: self.opts.order_id})})
        .then(function(r){return r.json()}).then(function(p){
          if (p.status === 'failed') { self.handlers['payment.failed'] && self.handlers['payment.failed']({error:{description:p.error_description, code:p.error_code}}); self.opts.modal && self.opts.modal.ondismiss && self.opts.modal.ondismiss(); return; }
          self.opts.handler && self.opts.handler({razorpay_payment_id: p.id, razorpay_order_id: p.order_id, razorpay_signature: 'stub'});
        });
    });
  };
  window.Razorpay = R;
})();`

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const path = url.pathname
  if (req.method === "OPTIONS") return json(res, 204, {})
  // ----- test controls
  if (path === "/checkout.js") {
    res.writeHead(200, { "content-type": "application/javascript", "access-control-allow-origin": "*" })
    return res.end(CHECKOUT_JS)
  }
  if (path === "/__test/mode") {
    if (req.method === "POST") Object.assign(state.mode, await readBody(req))
    return json(res, 200, state.mode)
  }
  if (path === "/__test/state") return json(res, 200, state)
  if (path === "/__test/reset") {
    Object.assign(state, { orders: {}, payments: {}, refunds: [], webhooksSent: [], mode: { outcome: "captured", webhook: true } })
    return json(res, 200, { ok: true })
  }
  if (path === "/__test/pay" && req.method === "POST") {
    const b = await readBody(req)
    const p = pay(b.order_id, b.outcome || state.mode.outcome)
    if (!p) return json(res, 404, { error: "no order" })
    if (state.mode.webhook) {
      const ev = p.status === "failed" ? "payment.failed" : p.status === "authorized" ? "payment.authorized" : "payment.captured"
      // deliver asynchronously like Razorpay does
      setTimeout(() => sendWebhook(ev, p, state.orders[p.order_id]), 200)
    }
    return json(res, 200, p)
  }
  if (path === "/__test/webhook" && req.method === "POST") {
    const b = await readBody(req)
    const p = state.payments[b.payment_id]
    if (!p) return json(res, 404, { error: "no payment" })
    return json(res, 200, await sendWebhook(b.event || "payment.captured", p, state.orders[p.order_id]))
  }
  // ----- Razorpay API subset
  if (!path.startsWith("/v1/")) return json(res, 404, { error: { description: "not found" } })
  if (!authOk(req)) return json(res, 401, { error: { code: "BAD_REQUEST_ERROR", description: "The api key provided is invalid" } })
  const p = path.slice(3)
  let m
  if (req.method === "POST" && p === "/orders") {
    const b = await readBody(req)
    if (!Number.isInteger(b.amount) || b.amount < 100) return json(res, 400, { error: { code: "BAD_REQUEST_ERROR", description: "The amount must be atleast INR 1.00" } })
    if (b.receipt && b.receipt.length > 40) return json(res, 400, { error: { code: "BAD_REQUEST_ERROR", description: "receipt: the length must not be greater than 40." } })
    const o = { id: id("order"), entity: "order", amount: b.amount, amount_paid: 0, amount_due: b.amount, currency: b.currency, receipt: b.receipt ?? null, status: "created", notes: b.notes ?? [], created_at: Math.floor(Date.now() / 1000) }
    state.orders[o.id] = o
    return json(res, 200, o)
  }
  if ((m = /^\/orders\/([^/]+)\/payments$/.exec(p))) {
    const items = Object.values(state.payments).filter((x) => x.order_id === m[1])
    return json(res, 200, { entity: "collection", count: items.length, items })
  }
  if ((m = /^\/orders\/([^/]+)$/.exec(p))) {
    const o = state.orders[m[1]]
    return o ? json(res, 200, o) : json(res, 400, { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } })
  }
  if ((m = /^\/payments\/([^/]+)\/capture$/.exec(p)) && req.method === "POST") {
    const b = await readBody(req)
    const x = state.payments[m[1]]
    if (!x) return json(res, 400, { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } })
    if (x.status !== "authorized") return json(res, 400, { error: { code: "BAD_REQUEST_ERROR", description: "This payment has already been captured" } })
    if (b.amount !== x.amount) return json(res, 400, { error: { code: "BAD_REQUEST_ERROR", description: "Capture amount must be equal to the amount authorized" } })
    x.status = "captured"
    x.captured = true
    state.orders[x.order_id].status = "paid"
    return json(res, 200, x)
  }
  if ((m = /^\/payments\/([^/]+)\/refunds$/.exec(p))) {
    const items = state.refunds.filter((r) => r.payment_id === m[1])
    return json(res, 200, { entity: "collection", count: items.length, items })
  }
  if ((m = /^\/payments\/([^/]+)\/refund$/.exec(p)) && req.method === "POST") {
    const b = await readBody(req)
    const x = state.payments[m[1]]
    if (!x || x.status !== "captured" && x.status !== "refunded") return json(res, 400, { error: { code: "BAD_REQUEST_ERROR", description: "Payment not captured" } })
    if (b.receipt && state.refunds.some((r) => r.receipt === b.receipt)) return json(res, 400, { error: { code: "BAD_REQUEST_ERROR", description: "Duplicate receipt found" } })
    const amt = b.amount ?? x.amount - x.amount_refunded
    if (amt > x.amount - x.amount_refunded) return json(res, 400, { error: { code: "BAD_REQUEST_ERROR", description: "The refund amount provided is greater than amount captured" } })
    const r = { id: id("rfnd"), entity: "refund", amount: amt, currency: x.currency, payment_id: x.id, receipt: b.receipt ?? null, status: "processed", notes: b.notes ?? {}, created_at: Math.floor(Date.now() / 1000) }
    state.refunds.push(r)
    x.amount_refunded += amt
    x.refund_status = x.amount_refunded === x.amount ? "full" : "partial"
    if (x.amount_refunded === x.amount) x.status = "refunded"
    return json(res, 200, r)
  }
  if ((m = /^\/payments\/([^/]+)$/.exec(p))) {
    const x = state.payments[m[1]]
    return x ? json(res, 200, x) : json(res, 400, { error: { code: "BAD_REQUEST_ERROR", description: "The id provided does not exist" } })
  }
  return json(res, 404, { error: { description: "not implemented in test double" } })
})

server.listen(PORT, "127.0.0.1", () => console.log(`razorpay test double on http://127.0.0.1:${PORT}`))
