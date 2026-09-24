"use server"

import type { HttpTypes } from "@medusajs/types"
import { medusa } from "../medusa"
import { errMessage } from "../meta"
import { getAuthHeaders, getCartId, placedInThisBrowser, removeAuthToken, setAuthToken } from "./cookies"
import type { ActionResult } from "./cart"

export type Customer = HttpTypes.StoreCustomer

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function msg(e: unknown, fallback: string) {
  const m = errMessage(e)
  return typeof m === "string" && m.length < 200 ? m : fallback
}

async function transferCart() {
  const cartId = await getCartId()
  if (!cartId) return
  try {
    await medusa().client.fetch(`/store/carts/${cartId}/customer`, { method: "POST", headers: await getAuthHeaders(), cache: "no-store" })
  } catch {
    /* cart belongs to someone else / completed — ignore */
  }
}

export async function getCustomer(): Promise<Customer | null> {
  const headers = await getAuthHeaders()
  if (!headers.authorization) return null
  try {
    const { customer } = await medusa().client.fetch<{ customer: Customer }>("/store/customers/me", {
      query: { fields: "*addresses" },
      headers,
      cache: "no-store",
    })
    return customer
  } catch {
    return null
  }
}

export async function login(input: { email: string; password: string }): Promise<ActionResult> {
  const email = (input.email ?? "").trim().toLowerCase()
  if (!EMAIL.test(email) || !input.password) return { ok: false, error: "Enter your email and password" }
  try {
    const res = await medusa().client.fetch<{ token: string }>("/auth/customer/emailpass", {
      method: "POST",
      body: { email, password: input.password },
      cache: "no-store",
    })
    if (!res?.token) return { ok: false, error: "Incorrect email or password" }
    await setAuthToken(res.token)
    await transferCart()
    return { ok: true }
  } catch {
    // Same message for unknown email and wrong password (no account enumeration).
    return { ok: false, error: "Incorrect email or password" }
  }
}

export async function register(input: {
  email: string
  password: string
  first_name: string
  last_name: string
  phone?: string
}): Promise<ActionResult> {
  const email = (input.email ?? "").trim().toLowerCase()
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid email address" }
  if ((input.password ?? "").length < 8) return { ok: false, error: "Password must be at least 8 characters" }
  if (!input.first_name?.trim() || !input.last_name?.trim()) return { ok: false, error: "Enter your first and last name" }
  let regToken: string
  try {
    const res = await medusa().client.fetch<{ token: string }>("/auth/customer/emailpass/register", {
      method: "POST",
      body: { email, password: input.password },
      cache: "no-store",
    })
    regToken = res.token
  } catch {
    // Identity exists (e.g. a customer migrated from our previous store).
    return {
      ok: false,
      error: "An account with this email already exists. Log in, or use “Forgot your password?” to set a new password.",
    }
  }
  try {
    await medusa().client.fetch("/store/customers", {
      method: "POST",
      body: {
        email,
        first_name: input.first_name.trim(),
        last_name: input.last_name.trim(),
        ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}),
      },
      headers: { authorization: `Bearer ${regToken}` },
      cache: "no-store",
    })
  } catch (e) {
    return { ok: false, error: msg(e, "Could not create your account") }
  }
  return login({ email, password: input.password })
}

export async function logout(): Promise<void> {
  await removeAuthToken()
}

/** Always reports success so the form cannot be used to discover accounts. */
export async function requestPasswordReset(emailRaw: string): Promise<ActionResult> {
  const email = (emailRaw ?? "").trim().toLowerCase()
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid email address" }
  try {
    await medusa().client.fetch("/auth/customer/emailpass/reset-password", {
      method: "POST",
      body: { identifier: email },
      cache: "no-store",
    })
  } catch {
    /* intentionally ignored */
  }
  return { ok: true }
}

export async function resetPassword(input: { token: string; email: string; password: string }): Promise<ActionResult> {
  if ((input.password ?? "").length < 8) return { ok: false, error: "Password must be at least 8 characters" }
  if (!input.token) return { ok: false, error: "This reset link is invalid" }
  try {
    await medusa().client.fetch("/auth/customer/emailpass/update", {
      method: "POST",
      body: { email: (input.email ?? "").trim().toLowerCase(), password: input.password },
      headers: { authorization: `Bearer ${input.token}` },
      cache: "no-store",
    })
    return { ok: true }
  } catch {
    return { ok: false, error: "This reset link is invalid or has expired. Please request a new one." }
  }
}

export async function updateProfile(input: { first_name: string; last_name: string; phone?: string }): Promise<ActionResult> {
  try {
    await medusa().client.fetch("/store/customers/me", {
      method: "POST",
      body: { first_name: input.first_name.trim(), last_name: input.last_name.trim(), phone: input.phone?.trim() || null },
      headers: await getAuthHeaders(),
      cache: "no-store",
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e, "Could not update profile") }
  }
}

export async function addAddress(a: Record<string, string>): Promise<ActionResult> {
  try {
    await medusa().client.fetch("/store/customers/me/addresses", {
      method: "POST",
      body: {
        first_name: a.first_name,
        last_name: a.last_name,
        address_1: a.address_1,
        address_2: a.address_2 || undefined,
        city: a.city,
        province: a.province,
        postal_code: a.postal_code,
        phone: a.phone,
        country_code: "in",
      },
      headers: await getAuthHeaders(),
      cache: "no-store",
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e, "Could not save address") }
  }
}

export async function deleteAddress(id: string): Promise<ActionResult> {
  try {
    await medusa().client.fetch(`/store/customers/me/addresses/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: await getAuthHeaders(),
      cache: "no-store",
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: msg(e, "Could not delete address") }
  }
}

const ORDER_FIELDS = "*items,+items.metadata,*shipping_address,*shipping_methods,*payment_collections,*payment_collections.payments,*fulfillments,+metadata"

export async function listOrders(): Promise<HttpTypes.StoreOrder[]> {
  const headers = await getAuthHeaders()
  if (!headers.authorization) return []
  const { orders } = await medusa().client.fetch<{ orders: HttpTypes.StoreOrder[] }>("/store/orders", {
    query: { fields: "id,display_id,created_at,status,payment_status,fulfillment_status,total,currency_code,*items,+metadata", limit: 50, order: "-created_at" },
    headers,
    cache: "no-store",
  })
  return orders
}

/**
 * Medusa's GET /store/orders/:id is retrievable by id alone. We only render an
 * order to the browser that placed it or to its logged-in owner.
 */
export async function getOrderForViewer(id: string): Promise<HttpTypes.StoreOrder | null> {
  const order = await getOrder(id)
  if (!order) return null
  if (await placedInThisBrowser(order.id)) return order
  const me = await getCustomer()
  if (me && order.customer_id === me.id) return order
  return null
}

async function getOrder(id: string): Promise<HttpTypes.StoreOrder | null> {
  try {
    const { order } = await medusa().client.fetch<{ order: HttpTypes.StoreOrder }>(`/store/orders/${encodeURIComponent(id)}`, {
      query: { fields: ORDER_FIELDS },
      headers: await getAuthHeaders(),
      cache: "no-store",
    })
    return order
  } catch {
    return null
  }
}
