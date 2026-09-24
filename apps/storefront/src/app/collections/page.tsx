import Image from "next/image"
import Link from "next/link"
import { ArrowIcon } from "@/components/icons"
import { listCategories } from "@/lib/data/catalog"
import { pageMetadata } from "@/lib/seo"
import { ms } from "@/lib/meta"

export const revalidate = 30
export const metadata = pageMetadata({ title: "Collections", path: "/collections" })

export default async function CollectionsPage() {
  const categories = await listCategories()
  return (
    <div className="page-width section">
      <h1>Collections</h1>
      <ul className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {categories.map((c) => {
          const img = ms(c, "image_url") as string | undefined
          return (
            <li key={c.id}>
              <Link href={`/collections/${c.handle}`} className="card">
                <div className="card__media card__media--square">
                  {img ? <Image src={img} alt={String(ms(c, "image_alt") || c.name)} fill sizes="(min-width: 990px) 400px, 50vw" style={{ objectFit: "cover" }} /> : null}
                </div>
                <div className="card__content">
                  <h2 className="collage__title">
                    {c.name} <ArrowIcon />
                  </h2>
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
