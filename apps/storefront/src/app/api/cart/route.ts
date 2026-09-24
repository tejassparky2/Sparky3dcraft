import { NextResponse } from "next/server"
import { retrieveCart } from "@/lib/data/cart"

export const dynamic = "force-dynamic"

/** Cart badge count for the (cacheable) pages' client header. */
export async function GET() {
  const cart = await retrieveCart().catch(() => null)
  const count = (cart?.items ?? []).reduce((n, i) => n + i.quantity, 0)
  return NextResponse.json({ count }, { headers: { "cache-control": "no-store" } })
}
