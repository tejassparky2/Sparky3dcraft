/**
 * Transactional email templates. Plain, dependency-free, HTML-escaped.
 * Copy is intentionally factual (no delivery promises); the merchant can
 * edit wording here.
 */

export type RenderedEmail = { subject: string; html: string; text: string }

export function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

const storeName = () => process.env.STORE_NAME || "Sparky 3D Craft Co"
const storefrontUrl = () => (process.env.STOREFRONT_URL || "").replace(/\/$/, "")

/** Same format as the storefront (live store): "Rs. 1,299.00 INR". */
export function formatMoney(amount: unknown, currency: string): string {
  const n = Number(amount)
  const cur = currency.toUpperCase()
  if (!Number.isFinite(n)) return `${amount} ${cur}`
  const num = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  return cur === "INR" ? `Rs. ${num} INR` : `${num} ${cur}`
}

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f6f6f6;font-family:Arial,Helvetica,sans-serif;color:#121212">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;padding:24px">
<tr><td><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(storeName())}</h1>
<h2 style="font-size:18px;margin:0 0 16px">${escapeHtml(title)}</h2>${bodyHtml}
<p style="font-size:12px;color:#666;margin-top:32px">${escapeHtml(storeName())}${storefrontUrl() ? ` · <a href="${escapeHtml(storefrontUrl())}">${escapeHtml(storefrontUrl())}</a>` : ""}</p>
</td></tr></table></td></tr></table></body></html>`
}

export function renderEmail(template: string, data: Record<string, any>): RenderedEmail {
  switch (template) {
    case "order-placed":
      return orderPlaced(data)
    case "password-reset":
      return passwordReset(data)
    case "contact-message":
      return renderContactMessage(data)
    default:
      throw new Error(`Unknown email template: ${template}`)
  }
}

function orderPlaced(d: Record<string, any>): RenderedEmail {
  const order = d.order ?? {}
  const cur = String(order.currency_code ?? "inr")
  const items: any[] = order.items ?? []
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:4px 0">${escapeHtml(i.product_title ?? i.title)}${
          i.variant_title && i.variant_title !== "Default" && i.variant_title !== "Default Title"
            ? ` <span style="color:#666">(${escapeHtml(i.variant_title)})</span>`
            : ""
        } × ${escapeHtml(i.quantity)}</td><td align="right">${escapeHtml(formatMoney(i.total ?? i.subtotal, cur))}</td></tr>`
    )
    .join("")
  const addr = order.shipping_address ?? {}
  const addrLines = [
    [addr.first_name, addr.last_name].filter(Boolean).join(" "),
    addr.address_1,
    addr.address_2,
    [addr.city, addr.province, addr.postal_code].filter(Boolean).join(", "),
    addr.phone,
  ].filter(Boolean)
  const payment = d.payment_method_label ? `<p><strong>Payment:</strong> ${escapeHtml(d.payment_method_label)}</p>` : ""
  const orderUrl = storefrontUrl() ? `${storefrontUrl()}/account/orders/${encodeURIComponent(order.id)}` : ""
  const html = layout(
    `Thank you for your order #${order.display_id ?? ""}`,
    `<p>Hi ${escapeHtml(addr.first_name || "")}, we have received your order.</p>
<table role="presentation" width="100%" style="font-size:14px;border-collapse:collapse">${rows}
<tr><td style="padding-top:8px">Shipping</td><td align="right" style="padding-top:8px">${escapeHtml(formatMoney(order.shipping_total ?? 0, cur))}</td></tr>
<tr><td style="padding-top:8px"><strong>Total</strong></td><td align="right" style="padding-top:8px"><strong>${escapeHtml(formatMoney(order.total, cur))}</strong></td></tr></table>
${payment}
<p><strong>Shipping to:</strong><br>${addrLines.map(escapeHtml).join("<br>")}</p>
${orderUrl ? `<p><a href="${escapeHtml(orderUrl)}">View your order</a></p>` : ""}`
  )
  const text = [
    `Thank you for your order #${order.display_id ?? ""}`,
    ...items.map((i) => `- ${i.product_title ?? i.title} x ${i.quantity}: ${formatMoney(i.total ?? i.subtotal, cur)}`),
    `Shipping: ${formatMoney(order.shipping_total ?? 0, cur)}`,
    `Total: ${formatMoney(order.total, cur)}`,
    d.payment_method_label ? `Payment: ${d.payment_method_label}` : "",
    orderUrl ? `View your order: ${orderUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n")
  return { subject: `${storeName()} — order #${order.display_id ?? ""} received`, html, text }
}

function passwordReset(d: Record<string, any>): RenderedEmail {
  const activation = d.variant === "activation"
  const url = String(d.url ?? "")
  const title = activation ? "Activate your account on our new store" : "Reset your password"
  const intro = activation
    ? "We have moved our store to a new platform. For your security, passwords could not be transferred. Please set a new password to access your account and order history."
    : "We received a request to reset the password for your account. If you did not request this, you can ignore this email."
  const html = layout(
    title,
    `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(url)}" style="display:inline-block;background:#121212;color:#fff;padding:12px 20px;border-radius:4px;text-decoration:none">${
      activation ? "Set my password" : "Reset password"
    }</a></p><p style="font-size:12px;color:#666">This link expires in 15 minutes.</p>`
  )
  return {
    subject: `${storeName()} — ${title.toLowerCase()}`,
    html,
    text: `${title}\n\n${intro}\n\n${url}\n\nThis link expires in 15 minutes.`,
  }
}

export function renderContactMessage(d: Record<string, any>): RenderedEmail {
  const rows = [
    ["Name", d.name],
    ["Email", d.email],
    ["Phone", d.phone],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<p><strong>${escapeHtml(k)}:</strong> ${escapeHtml(v)}</p>`)
    .join("")
  return {
    subject: `New contact form message from ${d.name || d.email}`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif">${rows}<p style="white-space:pre-wrap">${escapeHtml(d.message)}</p><p style="color:#666;font-size:12px">Message id ${escapeHtml(d.id)}</p></body></html>`,
    text: `Name: ${d.name ?? ""}\nEmail: ${d.email}\nPhone: ${d.phone ?? ""}\n\n${d.message}\n\nMessage id ${d.id}`,
  }
}
