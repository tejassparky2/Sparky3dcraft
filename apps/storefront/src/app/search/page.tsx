import type { Metadata } from "next"
import { ProductListing, type ListingParams } from "@/components/ProductListing"
import { listProducts } from "@/lib/data/catalog"
import { pageMetadata } from "@/lib/seo"

type Props = { searchParams: Promise<ListingParams> }

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams
  // Search result pages are not indexed (crawl trap), as on the live site.
  return pageMetadata({ title: q ? `Search: ${q.slice(0, 60)}` : "Search", path: "/search", noindex: true })
}

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams
  const q = (sp.q ?? "").trim().slice(0, 100)
  const products = q ? await listProducts({ q }) : []
  return (
    <div className="page-width section">
      <h1 className="center">Search results</h1>
      <form role="search" action="/search" method="get" style={{ maxWidth: 480, margin: "0 auto 32px", display: "flex", gap: 8 }}>
        <label htmlFor="search-page-input" className="visually-hidden">Search</label>
        <input id="search-page-input" className="input" type="search" name="q" defaultValue={q} placeholder="Search" maxLength={100} />
        <button className="button" type="submit">Search</button>
      </form>
      {q ? (
        <>
          <p className="center caption" aria-live="polite">
            {products.length} result{products.length === 1 ? "" : "s"} for “{q}”
          </p>
          <ProductListing products={products} params={sp} defaultSort="featured" ratio="square" hidden={{ q }} />
        </>
      ) : (
        <p className="center">Enter a search term to find products.</p>
      )}
    </div>
  )
}
