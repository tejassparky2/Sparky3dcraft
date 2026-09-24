import Image from "next/image"
import Link from "next/link"
import { ArrowIcon } from "@/components/icons"
import { ProductCard } from "@/components/ProductCard"
import { featuredOrder, getCategoryByHandle, listCategories, listProducts } from "@/lib/data/catalog"
import { site } from "@/lib/site"
import { jsonLd, pageMetadata, siteUrl } from "@/lib/seo"
import { ms } from "@/lib/meta"

export const revalidate = 30

export const metadata = {
  ...pageMetadata({ title: site.metaTitle, description: site.metaDescription, path: "/" }),
  title: { absolute: `${site.metaTitle} – ${site.name}` },
}

export default async function HomePage() {
  const categories = await listCategories()
  const collage = site.homeCollageHandles
    .map((h) => categories.find((c) => c.handle === h.trim()))
    .filter(Boolean) as typeof categories
  const featured = await getCategoryByHandle(site.homeFeaturedCategoryHandle)
  const featuredProducts = featured
    ? featuredOrder(await listProducts({ categoryId: featured.id }), ms(featured, "product_order")).slice(0, site.homeFeaturedLimit)
    : []

  return (
    <>
      <section className="section center">
        <div className="page-width">
          <h2 className="h1" style={{ margin: "8px 0 0" }}>{site.homeHeading}</h2>
        </div>
      </section>
      <section className="page-width" style={{ paddingBottom: 68 }} aria-label="Collections">
        {collage.length ? (
          <ul className="collage" style={{ listStyle: "none", padding: 0 }}>
            {collage.map((c, i) => {
              const img = ms(c, "image_url") as string | undefined
              return (
                <li key={c.id}>
                  <Link href={`/collections/${c.handle}`} className="card">
                    <div className="card__media" style={{ background: i ? "#fff" : undefined }}>
                      {img ? (
                        <Image src={img} alt={String(ms(c, "image_alt") || c.name)} fill sizes={i ? "(min-width: 750px) 66vw, 50vw" : "(min-width: 750px) 33vw, 50vw"} style={{ objectFit: "cover" }} priority />
                      ) : null}
                    </div>
                    <div className="card__content">
                      <h3 className="collage__title">
                        {c.name} <ArrowIcon />
                      </h3>
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        ) : null}
        {featuredProducts.length ? (
          <ul className="grid" aria-label={featured?.name}>
            {featuredProducts.map((p) => (
              <li key={p.id}>
                <ProductCard product={p} ratio="square" />
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd({
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: site.name,
          url: siteUrl(),
          potentialAction: { "@type": "SearchAction", target: `${siteUrl()}/search?q={search_term_string}`, "query-input": "required name=search_term_string" },
        })}
      />
    </>
  )
}
