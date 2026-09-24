import Link from "next/link"
import { CartLines } from "@/components/CartLines"
import { retrieveCart } from "@/lib/data/cart"
import { formatMoney } from "@/lib/money"
import { pageMetadata } from "@/lib/seo"
import { site } from "@/lib/site"

export const dynamic = "force-dynamic"
export const metadata = pageMetadata({ title: "Your Shopping Cart", path: "/cart", noindex: true })

export default async function CartPage() {
  const cart = await retrieveCart()
  const items = cart?.items ?? []
  if (!cart || !items.length) {
    return (
      <div className="page-width section center" data-testid="cart-empty">
        <h1>Your cart is empty</h1>
        <p>
          <Link href="/catalog" className="button">Continue shopping</Link>
        </p>
        <h2 className="h2" style={{ marginTop: 40, fontSize: 22 }}>Have an account?</h2>
        <p>
          <Link href="/login?next=/cart" className="link">Log in</Link> to check out faster.
        </p>
      </div>
    )
  }
  return (
    <div className="page-width section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
        <h1>Your cart</h1>
        <Link href="/catalog" className="link">Continue shopping</Link>
      </div>
      <CartLines
        currency={cart.currency_code}
        items={items.map((i) => ({
          id: i.id,
          title: i.product_title ?? i.title,
          handle: i.product_handle ?? i.product?.handle ?? null,
          variantTitle: i.variant_title && !/^default( title)?$/i.test(i.variant_title) ? i.variant_title : null,
          thumbnail: i.thumbnail ?? null,
          unitPrice: Number(i.unit_price),
          compareAt: Number(i.compare_at_unit_price ?? 0) || null,
          quantity: i.quantity,
          total: Number(i.total ?? i.subtotal ?? 0),
          metadata: (i.metadata ?? {}) as Record<string, string>,
        }))}
      />
      <div className="cart-footer">
        <div className="cart-footer__box">
          <p className="summary-row" style={{ justifyContent: "flex-end", gap: 16, fontSize: 18, color: "rgb(var(--fg))" }}>
            <span>Estimated total</span>
            <span data-testid="cart-total">{formatMoney(cart.item_total, cart.currency_code)}</span>
          </p>
          <p className="caption">{site.cartNote}</p>
          <Link href="/checkout" className="button button--full" data-testid="checkout-button">
            Check out
          </Link>
        </div>
      </div>
    </div>
  )
}
