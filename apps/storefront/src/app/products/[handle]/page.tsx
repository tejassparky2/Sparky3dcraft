import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { Price } from "@/components/Price"
import { ProductCard } from "@/components/ProductCard"
import { ProductForm } from "@/components/ProductForm"
import { ProductGallery } from "@/components/ProductGallery"
import { ShareButton } from "@/components/ShareButton"
import { categoriesForProduct, getProductByHandle, listProducts, productInStock, productMedia, variantPrice, variantInStock } from "@/lib/data/catalog"
import { parsePersonalization } from "@/lib/personalization"
import { sanitizeDescription } from "@/lib/sanitize"
import { jsonLd, pageMetadata, siteUrl, stripHtml } from "@/lib/seo"
import { site } from "@/lib/site"
import { ms } from "@/lib/meta"

export const revalidate = 30

type Props = { params: Promise<{ handle: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params
  const p = await getProductByHandle(handle)
  if (!p) return { title: "Not found" }
  const md = (p.metadata ?? {}) as Record<string, unknown>
  const price = variantPrice(p.variants?.[0])
  const base = pageMetadata({
    title: (md.seo_title as string) || p.title,
    description: (md.seo_description as string) || stripHtml(p.description).slice(0, 160),
    path: `/products/${p.handle}`,
    image: p.thumbnail,
  })
  return {
    ...base,
    other: price ? { "product:price:amount": price.amount.toFixed(2), "product:price:currency": price.currency.toUpperCase() } : undefined,
  }
}

export default async function ProductPage({ params }: Props) {
  const { handle } = await params
  const product = await getProductByHandle(handle)
  if (!product) notFound()
  const variant = product.variants?.[0]
  const price = variantPrice(variant)
  const inStock = productInStock(product)
  const media = productMedia(product)
  const cfg = parsePersonalization(product.metadata as Record<string, unknown>)
  const categories = await categoriesForProduct(product.id)
  const related = (
    categories[0] ? await listProducts({ categoryId: categories[0].id }) : await listProducts({ limit: 12 })
  )
    .filter((p) => p.id !== product.id)
    .slice(0, 4)
  const url = `${siteUrl()}/products/${product.handle}`
  const vendor = String(ms(product, "shopify_vendor") || site.name)

  return (
    <div className="page-width">
      <div className="product">
        <ProductGallery media={media} title={product.title} />
        <div className="product__info">
          <p className="product__vendor">{vendor}</p>
          <h1>{product.title}</h1>
          <div className="price--large" data-testid="product-price">
            <Price price={price} large showBadge />
            {!inStock ? <span className="badge badge--soldout" style={{ marginTop: 8 }}>Sold out</span> : null}
          </div>
          <p className="product__tax">{site.taxNote}</p>
          <ProductForm
            variantId={variant && variantInStock(variant) ? variant.id : variant?.id ?? null}
            inStock={inStock}
            personalization={cfg}
            title={product.title}
            thumbnail={product.thumbnail ?? null}
          />
          <div className="product__description rte" dangerouslySetInnerHTML={{ __html: sanitizeDescription(product.description) }} />
          <ShareButton url={url} title={product.title} />
        </div>
      </div>

      {related.length ? (
        <section className="section" aria-labelledby="related-heading">
          <h2 id="related-heading">You may also like</h2>
          <ul className="grid">
            {related.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} ratio="square" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd({
          "@context": "https://schema.org",
          "@type": "Product",
          "@id": `${url}#product`,
          name: product.title,
          url,
          description: stripHtml(product.description).slice(0, 5000),
          image: media.filter((m) => m.kind === "image").map((m) => m.url).slice(0, 10),
          brand: { "@type": "Brand", name: vendor },
          ...(variant?.sku ? { sku: variant.sku } : {}),
          ...(categories[0] ? { category: categories[0].name } : {}),
          offers: price
            ? {
                "@type": "Offer",
                url,
                price: price.amount.toFixed(2),
                priceCurrency: price.currency.toUpperCase(),
                availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
                itemCondition: "https://schema.org/NewCondition",
                seller: { "@type": "Organization", name: site.name },
              }
            : undefined,
        })}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl()}/` },
            ...(categories[0] ? [{ "@type": "ListItem", position: 2, name: categories[0].name, item: `${siteUrl()}/collections/${categories[0].handle}` }] : []),
            { "@type": "ListItem", position: categories[0] ? 3 : 2, name: product.title, item: url },
          ],
        })}
      />
    </div>
  )
}
