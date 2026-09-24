import Image from "next/image"
import type { Cart } from "@/lib/data/cart"
import { formatMoney } from "@/lib/money"
import { PromoCode } from "./PromoCode"

export function OrderSummary({ cart }: { cart: Cart }) {
  const cur = cart.currency_code
  return (
    <aside className="checkout__summary" aria-label="Order summary">
      <h2 style={{ fontSize: 22 }}>Order summary</h2>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {(cart.items ?? []).map((i) => {
          const m = (i.metadata ?? {}) as Record<string, string>
          return (
            <li key={i.id} style={{ display: "flex", gap: 12, marginBottom: 12 }}>
              {i.thumbnail ? <Image src={i.thumbnail} alt="" width={56} height={56} style={{ borderRadius: 6, objectFit: "cover" }} /> : null}
              <div style={{ flex: 1 }}>
                <div style={{ color: "rgb(var(--fg))" }}>
                  {i.product_title ?? i.title} × {i.quantity}
                </div>
                {m.choice_value ? <div className="caption">{m.choice_name}: {m.choice_value}</div> : null}
                {m.photo_filename ? <div className="caption">Photo: {m.photo_filename}</div> : null}
              </div>
              <div>{formatMoney(i.total ?? i.subtotal, cur)}</div>
            </li>
          )
        })}
      </ul>
      <PromoCode applied={(cart.promotions ?? []).map((p) => p.code).filter(Boolean) as string[]} />
      <div className="summary-row">
        <span>Subtotal</span>
        <span>{formatMoney(cart.item_total, cur)}</span>
      </div>
      {Number(cart.discount_total) > 0 ? (
        <div className="summary-row">
          <span>Discount</span>
          <span>−{formatMoney(cart.discount_total, cur)}</span>
        </div>
      ) : null}
      <div className="summary-row">
        <span>Shipping</span>
        <span data-testid="summary-shipping">{cart.shipping_methods?.length ? formatMoney(cart.shipping_total, cur) : "Calculated at next step"}</span>
      </div>
      <div className="summary-row summary-row--total">
        <span>Total</span>
        <span data-testid="summary-total">{formatMoney(cart.total, cur)}</span>
      </div>
      <p className="caption">Taxes included{Number(cart.tax_total) > 0 ? ` (${formatMoney(cart.tax_total, cur)})` : ""}.</p>
    </aside>
  )
}
