import Image from "next/image"
import Link from "next/link"
import { productInStock, productPrice, type Product } from "@/lib/data/catalog"
import { Price } from "./Price"
import { ms } from "@/lib/meta"

export function ProductCard({ product, ratio = "portrait", priority }: { product: Product; ratio?: "square" | "portrait"; priority?: boolean }) {
  const price = productPrice(product)
  const inStock = productInStock(product)
  const img = product.thumbnail ?? product.images?.[0]?.url
  const alt = String(ms(product.images?.[0], "alt") || product.title)
  return (
    <div className="card">
      <div className={`card__media card__media--${ratio}`}>
        {img ? (
          <Image src={img} alt={alt} fill sizes="(min-width: 990px) 280px, 50vw" priority={priority} style={{ objectFit: "cover" }} />
        ) : null}
        <div className="card__badge">
          {!inStock ? <span className="badge badge--soldout">Sold out</span> : price?.onSale ? <span className="badge">Sale</span> : null}
        </div>
      </div>
      <div className="card__content">
        <h3 className="card__title">
          <Link href={`/products/${product.handle}`} className="card__link" style={{ textDecoration: "none" }}>
            {product.title}
          </Link>
        </h3>
        <Price price={price} />
      </div>
    </div>
  )
}
