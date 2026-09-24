// Shared helpers for on-server verification programs (Node >= 22, no deps).
export const env = (k, d) => {
  const v = process.env[k] ?? d
  if (v === undefined || v === "") throw new Error(`missing env ${k}`)
  return v
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function adminSession(api, email, password) {
  const r = await fetch(`${api}/auth/user/emailpass`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) })
  const d = await r.json()
  if (!d.token) throw new Error("admin login failed")
  return async (method, path, body) => {
    const res = await fetch(`${api}${path}`, { method, headers: { authorization: `Bearer ${d.token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await res.text()
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 200)}`)
    return text ? JSON.parse(text) : {}
  }
}
export async function eventually(label, fn, seconds = 75) {
  const end = Date.now() + seconds * 1000
  let last
  while (Date.now() < end) {
    try {
      if (await fn()) {
        console.log(`ok   ${label}`)
        return
      }
    } catch (e) {
      last = e
    }
    await sleep(2500)
  }
  throw new Error(`timeout: ${label}${last ? ` (${last.message})` : ""}`)
}
export async function page(url) {
  const r = await fetch(url, { headers: { "cache-control": "no-cache" } })
  return { status: r.status, html: await r.text() }
}
