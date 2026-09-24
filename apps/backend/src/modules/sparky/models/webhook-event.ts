import { model } from "@medusajs/framework/utils"

/**
 * Ledger of inbound provider webhooks. (provider, event_id) is unique so a
 * retried delivery is detected before any side effect is triggered.
 */
const WebhookEvent = model
  .define("sparky_webhook_event", {
    id: model.id({ prefix: "whevt" }).primaryKey(),
    provider: model.text(),
    event_id: model.text(),
    event_type: model.text(),
    status: model.enum(["received", "dispatched", "ignored", "failed"]).default("received"),
    session_id: model.text().nullable(),
    provider_reference: model.text().nullable(), // e.g. razorpay payment id
    received_count: model.number().default(1),
    error: model.text().nullable(),
  })
  .indexes([
    { on: ["provider", "event_id"], unique: true, where: "deleted_at IS NULL" },
  ])

export default WebhookEvent
