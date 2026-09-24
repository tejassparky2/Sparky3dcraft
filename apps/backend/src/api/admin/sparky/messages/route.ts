import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { SPARKY_MODULE } from "../../../../modules/sparky"
import type SparkyModuleService from "../../../../modules/sparky/service"

/** GET /admin/sparky/messages — contact form messages and newsletter subscribers. */
export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const sparky = req.scope.resolve<SparkyModuleService>(SPARKY_MODULE)
  const [messages, messageCount] = await sparky.listAndCountContactMessages({}, { take: 200, order: { created_at: "DESC" } })
  const [subscribers, subscriberCount] = await sparky.listAndCountNewsletterSubscribers({}, { take: 1000, order: { created_at: "DESC" } })
  res.json({ messages, message_count: messageCount, subscribers, subscriber_count: subscriberCount })
}

/** POST /admin/sparky/messages — mark a message read/archived. */
export async function POST(req: AuthenticatedMedusaRequest<{ id: string; status: "new" | "read" | "archived" }>, res: MedusaResponse) {
  const { id, status } = req.body ?? ({} as any)
  if (!id || !["new", "read", "archived"].includes(status)) return res.status(400).json({ message: "id and valid status required" })
  const sparky = req.scope.resolve<SparkyModuleService>(SPARKY_MODULE)
  const updated = await sparky.updateContactMessages({ id, status })
  res.json({ message: updated })
}
