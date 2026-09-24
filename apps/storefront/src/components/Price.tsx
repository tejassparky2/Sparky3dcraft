import { formatMoney } from "@/lib/money"
import type { PriceInfo } from "@/lib/data/catalog"

export function Price({ price, large, showBadge }: { price: PriceInfo | null; large?: boolean; showBadge?: boolean }) {
  if (!price) return <div className="price">Price unavailable</div>
  return (
    <div className={`price${large ? " price--large" : ""}`}>
      {price.onSale ? (
        <>
          <span className="visually-hidden">Regular price</span>
          <s className="price__compare">{formatMoney(price.original, price.currency)}</s>
          <span className="visually-hidden">Sale price</span>
          <span className="price__regular">{formatMoney(price.amount, price.currency)}</span>
          {showBadge ? <span className="badge">Sale</span> : null}
        </>
      ) : (
        <>
          <span className="visually-hidden">Regular price</span>
          <span className="price__regular">{formatMoney(price.amount, price.currency)}</span>
        </>
      )}
    </div>
  )
}
