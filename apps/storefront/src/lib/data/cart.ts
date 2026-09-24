"use server"

import type { HttpTypes } from "@medusajs/types"
import { medusa } from "../medusa"
import { errMessage } from "../meta"
import { getRegion } from "./catalog"
import { getAuthHeaders, getCartId, rememberOrder, removeCartId, setCartId } from "./cookies"

export type Cart = HttpTypes.StoreCart
export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string }

const CART_FIELDS = [
  "*items",
  "+items.metadata",
  "*items.product",
  "*items.variant",
  "*shipping_methods",
  "*shipping_address",
  "*billing_address",
  "*payment_collection",
  "*payment_collection.payment_sessions",
  "*region",
  "*promotions",
].join(",")

function errorMessage(e: unknown): string {
  const m = errMessage(e)
  if (typeof m === "string" && m.length < 300) return m
  return "Something went wrong. Please try again."
}

export async function retrieveCart(): Promise<Cart | null> {
  const id = await getCartId()
  if (!id) return null
  try {
    const { cart } = await medusa().client.fetch<{ cart: Cart }>(`/store/carts/${id}`, {
      query: { fields: CART_FIELDS },
      headers: await getAuthHeaders(),
      cache: "no-store",
    })
    if ((cart as { completed_at?: string | null }).completed_at) {
      await removeCartId()
      return null
    }
    return cart
  } catch {
    // Expired / deleted / completed cart: start fresh.
    await removeCartId()
    return null
  }
}

export async function getOrCreateCart(): Promise<Cart> {
  const existing = await retrieveCart()
  if (existing) return existing
  const region = await getRegion()
  const { cart } = await medusa().client.fetch<{ cart: Cart }>("/store/carts", {
    method: "POST",
    body: { region_id: region.id },
    headers: await getAuthHeaders(),
    cache: "no-store",
  })
  await setCartId(cart.id)
  return cart
}

export async function cartItemCount(): Promise<number> {
  const cart = await retrieveCart()
  return (cart?.items ?? []).reduce((n, i) => n + i.quantity, 0)
}

export async function addToCart(input: {
  variantId: string
  quantity: number
  personalization?: { photo_upload_id?: string; choice_value?: string; custom_text?: string }
}): Promise<ActionResult<{ count: number }>> {
  const qty = Math.floor(Number(input.quantity))
  if (!input.variantId || !Number.isFinite(qty) || qty < 1 || qty > 99) return { ok: false, error: "Invalid quantity" }
  try {
    const cart = await getOrCreateCart()
    const { cart: updated } = await medusa().client.fetch<{ cart: Cart }>(`/store/carts/${cart.id}/line-items`, {
      method: "POST",
      body: {
        variant_id: input.variantId,
        quantity: qty,
        ...(input.personalization && Object.values(input.personalization).some(Boolean) ? { metadata: input.personalization } : {}),
      },
      headers: await getAuthHeaders(),
      cache: "no-store",
    })
    return { ok: true, data: { count: (updated.items ?? []).reduce((n, i) => n + i.quantity, 0) } }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

export async function updateLineItem(lineId: string, quantity: number): Promise<ActionResult> {
  const id = await getCartId()
  if (!id) return { ok: false, error: "Your cart has expired" }
  const qty = Math.floor(Number(quantity))
  if (!Number.isFinite(qty) || qty < 0 || qty > 99) return { ok: false, error: "Invalid quantity" }
  try {
    if (qty === 0) {
      await medusa().client.fetch(`/store/carts/${id}/line-items/${lineId}`, { method: "DELETE", headers: await getAuthHeaders(), cache: "no-store" })
    } else {
      await medusa().client.fetch(`/store/carts/${id}/line-items/${lineId}`, {
        method: "POST",
        body: { quantity: qty },
        headers: await getAuthHeaders(),
        cache: "no-store",
      })
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

// ------------------------------------------------------------------ checkout

export type AddressInput = {
  first_name: string
  last_name: string
  address_1: string
  address_2?: string
  city: string
  province: string
  postal_code: string
  phone: string
  company?: string
}

const PIN = /^[1-9][0-9]{5}$/
const PHONE = /^(\+91[\s-]?)?[6-9][0-9]{9}$/

export async function validateAddress(a: AddressInput): Promise<string[]> {
  const errs: string[] = []
  if (!a.first_name?.trim()) errs.push("First name is required")
  if (!a.last_name?.trim()) errs.push("Last name is required")
  if (!a.address_1?.trim()) errs.push("Address is required")
  if (!a.city?.trim()) errs.push("City is required")
  if (!a.province?.trim()) errs.push("State is required")
  if (!PIN.test((a.postal_code ?? "").trim())) errs.push("Enter a valid 6-digit PIN code")
  if (!PHONE.test((a.phone ?? "").replace(/\s/g, ""))) errs.push("Enter a valid 10-digit Indian mobile number")
  return errs
}

export async function setCheckoutAddress(input: { email: string; address: AddressInput }): Promise<ActionResult> {
  const id = await getCartId()
  if (!id) return { ok: false, error: "Your cart has expired" }
  const email = (input.email ?? "").trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email address" }
  const errs = await validateAddress(input.address)
  if (errs.length) return { ok: false, error: errs.join(". ") }
  const address = {
    first_name: input.address.first_name.trim(),
    last_name: input.address.last_name.trim(),
    address_1: input.address.address_1.trim(),
    address_2: input.address.address_2?.trim() || undefined,
    company: input.address.company?.trim() || undefined,
    city: input.address.city.trim(),
    province: input.address.province.trim(),
    postal_code: input.address.postal_code.trim(),
    phone: input.address.phone.replace(/\s/g, ""),
    country_code: "in",
  }
  try {
    await medusa().client.fetch(`/store/carts/${id}`, {
      method: "POST",
      body: { email, shipping_address: address, billing_address: address },
      headers: await getAuthHeaders(),
      cache: "no-store",
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

export type ShippingOption = { id: string; name: string; amount: number; description: string | null }

export async function listShippingOptions(): Promise<ShippingOption[]> {
  const id = await getCartId()
  if (!id) return []
  const { shipping_options } = await medusa().client.fetch<{ shipping_options: HttpTypes.StoreCartShippingOption[] }>("/store/shipping-options", {
    query: { cart_id: id },
    headers: await getAuthHeaders(),
    cache: "no-store",
  })
  return shipping_options.map((o) => ({
    id: o.id,
    name: o.name,
    amount: Number(o.calculated_price?.calculated_amount ?? o.amount ?? 0),
    description: o.type?.description || null,
  }))
}

export async function setShippingMethod(optionId: string): Promise<ActionResult> {
  const id = await getCartId()
  if (!id) return { ok: false, error: "Your cart has expired" }
  try {
    await medusa().client.fetch(`/store/carts/${id}/shipping-methods`, {
      method: "POST",
      body: { option_id: optionId },
      headers: await getAuthHeaders(),
      cache: "no-store",
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

export type PaymentProvider = { id: string; label: string }

export async function listPaymentProviders(): Promise<PaymentProvider[]> {
  const region = await getRegion()
  const { payment_providers } = await medusa().client.fetch<{ payment_providers: { id: string }[] }>(
    "/store/payment-providers",
    { query: { region_id: region.id }, cache: "no-store" }
  )
  const label = (id: string) =>
    id.startsWith("pp_razorpay") ? "Pay online (UPI, cards, netbanking, wallets) — Razorpay" : id.startsWith("pp_cod") ? "Cash on Delivery" : id
  // pp_system_default never reaches customers (setup-store removes it in production).
  return payment_providers.filter((p) => p.id !== "pp_system_default").map((p) => ({ id: p.id, label: label(p.id) }))
}

/**
 * Creates (or re-uses) the payment session for the chosen provider and
 * returns the PUBLIC session data the browser needs (Razorpay order id,
 * amount, key id). Never returns secrets — the provider never stores them.
 */
export async function initiatePayment(providerId: string): Promise<ActionResult<{ provider_id: string; data: Record<string, unknown> }>> {
  const id = await getCartId()
  if (!id) return { ok: false, error: "Your cart has expired" }
  try {
    const headers = await getAuthHeaders()
    const { cart } = await medusa().client.fetch<{ cart: Cart }>(`/store/carts/${id}`, {
      query: { fields: "id,total,*payment_collection,*payment_collection.payment_sessions" },
      headers,
      cache: "no-store",
    })
    let collectionId = cart.payment_collection?.id
    if (!collectionId) {
      const { payment_collection } = await medusa().client.fetch<{ payment_collection: { id: string } }>("/store/payment-collections", {
        method: "POST",
        body: { cart_id: id },
        headers,
        cache: "no-store",
      })
      collectionId = payment_collection.id
    }
    const { payment_collection } = await medusa().client.fetch<{ payment_collection: HttpTypes.StorePaymentCollection }>(
      `/store/payment-collections/${collectionId}/payment-sessions`,
      { method: "POST", body: { provider_id: providerId }, headers, cache: "no-store" }
    )
    const session = payment_collection.payment_sessions?.find((s) => s.provider_id === providerId)
    if (!session) return { ok: false, error: "Could not start payment" }
    const d = (session.data ?? {}) as Record<string, unknown>
    const publicData: Record<string, unknown> = providerId.startsWith("pp_razorpay")
      ? { razorpay_order_id: d.razorpay_order_id, amount: d.amount, currency: d.currency, key_id: d.key_id, merchant_name: d.merchant_name }
      : {}
    return { ok: true, data: { provider_id: providerId, data: publicData } }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

/**
 * Completes the cart. For Razorpay the server re-verifies payment with
 * Razorpay inside Medusa (authorizePayment) — the browser callback is not
 * trusted. Completing an already-completed cart returns the same order, so
 * double submission cannot create a second order.
 */
export async function completeCart(): Promise<ActionResult<{ orderId: string }>> {
  const id = await getCartId()
  if (!id) return { ok: false, error: "Your cart has expired. If you were charged, your order will still be confirmed by email." }
  try {
    const res = await medusa().client.fetch<{ type: "order"; order: HttpTypes.StoreOrder } | { type: "cart"; cart: Cart; error: { message: string } }>(
      `/store/carts/${id}/complete`,
      { method: "POST", headers: await getAuthHeaders(), cache: "no-store" }
    )
    if (res.type === "order") {
      await removeCartId()
      await rememberOrder(res.order.id)
      return { ok: true, data: { orderId: res.order.id } }
    }
    return { ok: false, error: res.error?.message || "Payment was not completed" }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}

export async function applyPromotion(code: string): Promise<ActionResult> {
  const id = await getCartId()
  if (!id) return { ok: false, error: "Your cart has expired" }
  const c = code.trim()
  if (!c || c.length > 64) return { ok: false, error: "Enter a valid code" }
  try {
    const { cart } = await medusa().client.fetch<{ cart: Cart }>(`/store/carts/${id}/promotions`, {
      method: "POST",
      body: { promo_codes: [c] },
      headers: await getAuthHeaders(),
      cache: "no-store",
    })
    if (!(cart.promotions ?? []).some((p) => p.code?.toLowerCase() === c.toLowerCase())) {
      return { ok: false, error: "This discount code is not valid for your cart" }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errorMessage(e) }
  }
}
