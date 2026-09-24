import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { ProductListing, type ListingParams } from "@/components/ProductListing"
import { getCategoryByHandle, listProducts } from "@/lib/data/catalog"
import { jsonLd, pageMetadata, siteUrl } from "@/lib/seo"
import { ms } from "@/lib/meta"

type Props = { params: Promise<{ handle: string }>; searchParams: Promise<ListingParams> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params
  const c = await getCategoryByHandle(handle)
  if (!c) return { title: "Not found" }
  return pageMetadata({
    title: c.name,
    description: c.description || undefined,
    path: `/collections/${c.handle}`,
    image: (ms(c, "image_url") as string) || null,
  })
}

export default async function CollectionPage({ params, searchParams }: Props) {
  const { handle } = await params
  const category = await getCategoryByHandle(handle)
  if (!category) notFound()
  const [sp, products] = await Promise.all([searchParams, listProducts({ categoryId: category.id })])
  return (
    <div className="page-width section">
      <h1>
        <span className="visually-hidden">Collection: </span>
        {category.name}
      </h1>
      {category.description ? <p>{category.description}</p> : null}
      <ProductListing products={products} params={sp} defaultSort="featured" featuredOrderCsv={ms(category, "product_order")} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl()}/` },
            { "@type": "ListItem", position: 2, name: category.name, item: `${siteUrl()}/collections/${category.handle}` },
          ],
        })}
      />
    </div>
  )
}
