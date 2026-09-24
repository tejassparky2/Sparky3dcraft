import type { HttpTypes } from "@medusajs/types"
import { formatMoney } from "@/lib/money"
import { meta } from "@/lib/meta"

export function paymentLabel(order: HttpTypes.StoreOrder): string {
  const pid = order.payment_collections?.[0]?.payments?.[0]?.provider_id ?? ""
  if (meta(order).historical === true) return "Paid via previous store (Shopify)"
  if (pid.startsWith("pp_cod")) return "Cash on Delivery — pay when your order arrives"
  if (pid.startsWith("pp_razorpay")) return "Paid online (Razorpay)"
  return "—"
}

export function OrderDetails({ order }: { order: HttpTypes.StoreOrder }) {
  const cur = order.currency_code
  const a = order.shipping_address
  return (
    <div>
      <table className="table" aria-label="Items">
        <thead>
          <tr>
            <th>Product</th>
            <th>Qty</th>
            <th style={{ textAlign: "right" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {(order.items ?? []).map((i) => {
            const m = (i.metadata ?? {}) as Record<string, string>
            return (
              <tr key={i.id}>
                <td>
                  {i.product_title ?? i.title}
                  {m.choice_value ? <div className="caption">{m.choice_name}: {m.choice_value}</div> : null}
                  {m.photo_filename ? <div className="caption">Photo: {m.photo_filename}</div> : null}
                </td>
                <td>{i.quantity}</td>
                <td style={{ textAlign: "right" }}>{formatMoney(i.total, cur)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ maxWidth: 380, marginLeft: "auto", marginTop: 16 }}>
        <div className="summary-row"><span>Subtotal</span><span>{formatMoney(order.item_total, cur)}</span></div>
        {Number(order.discount_total) > 0 ? <div className="summary-row"><span>Discount</span><span>−{formatMoney(order.discount_total, cur)}</span></div> : null}
        <div className="summary-row"><span>Shipping</span><span>{formatMoney(order.shipping_total, cur)}</span></div>
        <div className="summary-row summary-row--total"><span>Total</span><span data-testid="order-total">{formatMoney(order.total, cur)}</span></div>
        <p className="caption">Taxes included.</p>
      </div>
      <div className="field-row" style={{ marginTop: 24 }}>
        <div>
          <h2 style={{ fontSize: 20 }}>Shipping address</h2>
          <p>
            {[`${a?.first_name ?? ""} ${a?.last_name ?? ""}`.trim(), a?.address_1, a?.address_2, [a?.city, a?.province, a?.postal_code].filter(Boolean).join(", "), a?.phone]
              .filter(Boolean)
              .map((l, i) => (
                <span key={i} style={{ display: "block" }}>{l}</span>
              ))}
          </p>
        </div>
        <div>
          <h2 style={{ fontSize: 20 }}>Payment</h2>
          <p data-testid="payment-label">{paymentLabel(order)}</p>
        </div>
      </div>
    </div>
  )
}
