import crypto from "node:crypto"
import { revalidateTag } from "next/cache"
import { NextResponse, type NextRequest } from "next/server"
import { config } from "@/lib/config"
import { CATALOG_TAG } from "@/lib/medusa"

/**
 * POST /api/revalidate — called by the Medusa worker (subscriber) when the
 * catalog changes, so Admin edits appear immediately without a rebuild.
 * Authenticated with a shared secret (constant-time compare).
 */
export async function POST(req: NextRequest) {
  const secret = config.revalidateSecret()
  const given = req.headers.get("x-revalidate-secret") ?? ""
  if (!secret || given.length !== secret.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  revalidateTag(CATALOG_TAG, { expire: 0 })
  return NextResponse.json({ ok: true, revalidated: CATALOG_TAG, at: new Date().toISOString() })
}
