import { ProductListing, type ListingParams } from "@/components/ProductListing"
import { listProducts } from "@/lib/data/catalog"
import { pageMetadata } from "@/lib/seo"

export const metadata = pageMetadata({ title: "Products", path: "/catalog" })

export default async function CatalogPage({ searchParams }: { searchParams: Promise<ListingParams> }) {
  const [params, products] = await Promise.all([searchParams, listProducts()])
  return (
    <div className="page-width section">
      <h1>Products</h1>
      <ProductListing products={products} params={params} defaultSort="title-ascending" />
    </div>
  )
}
