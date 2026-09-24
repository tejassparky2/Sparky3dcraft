import { ProductCard } from "./ProductCard"
import { AutoSubmit } from "./AutoSubmit"
import { SORT_OPTIONS, featuredOrder, filterProducts, sortProducts, productPrice, type Filters, type Product, type SortKey } from "@/lib/data/catalog"
import { formatMoney } from "@/lib/money"

export type ListingParams = { sort?: string; availability?: string; min?: string; max?: string; q?: string }

export function parseListingParams(sp: ListingParams, defaultSort: SortKey) {
  const sort = (SORT_OPTIONS.some((o) => o.value === sp.sort) ? sp.sort : defaultSort) as SortKey
  const num = (v?: string) => (v !== undefined && v !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined)
  const filters: Filters = {
    availability: sp.availability === "in" || sp.availability === "out" ? sp.availability : undefined,
    min: num(sp.min),
    max: num(sp.max),
  }
  return { sort, filters }
}

export function ProductListing({
  products,
  params,
  defaultSort,
  ratio = "portrait",
  hidden,
  featuredOrderCsv,
}: {
  products: Product[]
  params: ListingParams
  defaultSort: SortKey
  ratio?: "square" | "portrait"
  hidden?: Record<string, string>
  /** category metadata product_order (for "Featured") */
  featuredOrderCsv?: string
}) {
  const { sort, filters } = parseListingParams(params, defaultSort)
  const filtered = filterProducts(products, filters)
  const visible = sort === "featured" ? featuredOrder(filtered, featuredOrderCsv) : sortProducts(filtered, sort)
  const highest = Math.max(0, ...products.map((p) => productPrice(p)?.amount ?? 0))
  const currency = products.map((p) => productPrice(p)?.currency).find(Boolean) ?? "inr"
  const inCount = filterProducts(products, { availability: "in" }).length
  return (
    <>
      <form className="facets" method="get" aria-label="Filter and sort">
        {hidden ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
        <div className="facets__group">
          <label>
            <span className="visually-hidden">Availability</span>
            <select name="availability" defaultValue={filters.availability ?? ""} aria-label="Availability">
              <option value="">Availability</option>
              <option value="in">In stock ({inCount})</option>
              <option value="out">Out of stock ({products.length - inCount})</option>
            </select>
          </label>
          <label>
            <span className="caption" style={{ display: "block" }}>Price from (₹)</span>
            <input type="number" name="min" min={0} step="1" inputMode="numeric" defaultValue={filters.min ?? ""} placeholder="0" />
          </label>
          <label>
            <span className="caption" style={{ display: "block" }}>to (₹)</span>
            <input type="number" name="max" min={0} step="1" inputMode="numeric" defaultValue={filters.max ?? ""} placeholder={String(Math.ceil(highest))} />
          </label>
          <button className="button button--secondary" type="submit" style={{ minHeight: 40, padding: "0 16px" }}>
            Apply
          </button>
        </div>
        <div className="facets__group">
          <label>
            <span className="caption" style={{ display: "block" }}>Sort by</span>
            <select name="sort" defaultValue={sort}>
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <span className="caption" aria-live="polite">{visible.length} product{visible.length === 1 ? "" : "s"}</span>
        </div>
        <AutoSubmit />
      </form>
      {highest ? <p className="visually-hidden">The highest price is {formatMoney(highest, currency)}</p> : null}
      {visible.length ? (
        <ul className="grid">
          {visible.map((p, i) => (
            <li key={p.id}>
              <ProductCard product={p} ratio={ratio} priority={i < 4} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="center" style={{ padding: "40px 0" }}>
          <p>No products found</p>
          <a className="link" href="?">Remove all filters</a>
        </div>
      )}
    </>
  )
}
