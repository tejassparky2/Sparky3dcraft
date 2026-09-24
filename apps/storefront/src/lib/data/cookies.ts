import "server-only"
import { cookies } from "next/headers"

const CART = "_sparky_cart_id"
const JWT = "_sparky_jwt"
const secure = () => process.env.NODE_ENV === "production" && process.env.COOKIE_INSECURE !== "true"

export async function getCartId(): Promise<string | undefined> {
  return (await cookies()).get(CART)?.value
}

export async function setCartId(id: string) {
  ;(await cookies()).set(CART, id, { httpOnly: true, sameSite: "lax", secure: secure(), path: "/", maxAge: 60 * 60 * 24 * 30 })
}

export async function removeCartId() {
  ;(await cookies()).set(CART, "", { maxAge: -1, path: "/" })
}

export async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = (await cookies()).get(JWT)?.value
  return token ? { authorization: `Bearer ${token}` } : {}
}

export async function setAuthToken(token: string) {
  ;(await cookies()).set(JWT, token, { httpOnly: true, sameSite: "lax", secure: secure(), path: "/", maxAge: 60 * 60 * 24 * 7 })
}

export async function removeAuthToken() {
  ;(await cookies()).set(JWT, "", { maxAge: -1, path: "/" })
}

const ORDERS = "_sparky_orders"

/** Orders placed from this browser (for the confirmation page guard). */
export async function rememberOrder(id: string) {
  const jar = await cookies()
  const ids = (jar.get(ORDERS)?.value ?? "").split(",").filter(Boolean).slice(-4)
  ids.push(id)
  jar.set(ORDERS, ids.join(","), { httpOnly: true, sameSite: "lax", secure: secure(), path: "/", maxAge: 60 * 60 * 24 * 3 })
}

export async function placedInThisBrowser(id: string): Promise<boolean> {
  return ((await cookies()).get(ORDERS)?.value ?? "").split(",").includes(id)
}
