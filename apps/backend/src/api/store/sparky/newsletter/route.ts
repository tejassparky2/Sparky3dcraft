import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { z } from "@medusajs/framework/zod"
import { SPARKY_MODULE } from "../../../../modules/sparky"
import type SparkyModuleService from "../../../../modules/sparky/service"

const Body = z.object({ email: z.string().trim().email().max(254), company: z.string().max(0).optional() })

/** POST /store/sparky/newsletter — footer signup. Same response whether new or existing (no enumeration). */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  if (typeof (req.body as any)?.company === "string" && (req.body as any).company.length > 0) {
    return res.status(200).json({ ok: true })
  }
  const parsed = Body.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: "Please enter a valid email address" })
  const email = parsed.data.email.toLowerCase()
  const sparky = req.scope.resolve<SparkyModuleService>(SPARKY_MODULE)
  const [existing] = await sparky.listNewsletterSubscribers({ email })
  if (!existing) {
    try {
      await sparky.createNewsletterSubscribers({ email, status: "subscribed", source: "storefront-footer" })
    } catch {
      /* concurrent duplicate — unique index; treat as subscribed */
    }
  } else if (existing.status !== "subscribed") {
    await sparky.updateNewsletterSubscribers({ id: existing.id, status: "subscribed" })
  }
  res.status(200).json({ ok: true })
}
