import { NextResponse, type NextRequest } from "next/server"
import { listProducts, productPrice } from "@/lib/data/catalog"
import { formatMoney } from "@/lib/money"

/** Predictive search for the header modal (real Medusa catalog, q filter). */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100)
  if (q.length < 2) return NextResponse.json({ products: [] })
  try {
    const products = (await listProducts({ q, limit: 6 })).slice(0, 6)
    return NextResponse.json({
      products: products.map((p) => {
        const pr = productPrice(p)
        return {
          handle: p.handle,
          title: p.title,
          thumbnail: p.thumbnail ?? null,
          price: pr ? formatMoney(pr.amount, pr.currency) : "",
          compare: pr?.onSale ? formatMoney(pr.original, pr.currency) : null,
        }
      }),
    })
  } catch {
    return NextResponse.json({ products: [] }, { status: 502 })
  }
}
