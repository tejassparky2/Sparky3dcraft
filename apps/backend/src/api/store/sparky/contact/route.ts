import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { z } from "@medusajs/framework/zod"
import { SPARKY_MODULE } from "../../../../modules/sparky"
import type SparkyModuleService from "../../../../modules/sparky/service"

export const ContactBody = z.object({
  name: z.string().trim().max(120).optional().default(""),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(40).regex(/^[0-9+()\-\s]*$/, "Invalid phone number").optional().default(""),
  message: z.string().trim().max(5000).optional().default(""),
  // Honeypot: real browsers leave this empty (field is visually hidden).
  company: z.string().max(0).optional().default(""),
})

/** POST /store/sparky/contact — contact form (matches the live site's fields). */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  // Honeypot filled → pretend success, store nothing (don't teach bots).
  if (typeof (req.body as any)?.company === "string" && (req.body as any).company.length > 0) {
    return res.status(201).json({ ok: true })
  }
  const parsed = ContactBody.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues.map((i) => i.message).join("; ") })
  }
  const d = parsed.data
  const sparky = req.scope.resolve<SparkyModuleService>(SPARKY_MODULE)
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const msg = await sparky.createContactMessages({
    name: d.name || null,
    email: d.email.toLowerCase(),
    phone: d.phone || null,
    message: d.message || "(no message)",
  })
  const to = process.env.MERCHANT_NOTIFICATION_EMAIL
  if (to) {
    try {
      const notification: any = req.scope.resolve(Modules.NOTIFICATION)
      await notification.createNotifications({
        to,
        channel: "email",
        template: "contact-message",
        data: { name: d.name, email: d.email, phone: d.phone, message: d.message, id: msg.id },
      })
      await sparky.updateContactMessages({ id: msg.id, notified: true })
    } catch (e) {
      logger.warn(`[contact] merchant notification failed for ${msg.id}: ${(e as Error).message}`)
    }
  }
  res.status(201).json({ ok: true })
}
