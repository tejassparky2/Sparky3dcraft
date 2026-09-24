import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import {
  ContainerRegistrationKeys,
  Modules,
  PaymentWebhookEvents,
} from "@medusajs/framework/utils"
import crypto from "node:crypto"
import { SPARKY_MODULE } from "../../../modules/sparky"
import type SparkyModuleService from "../../../modules/sparky/service"
import { headerValue, notesOf, verifyWebhookSignature } from "../../../modules/razorpay/utils"

/** Medusa payment provider key: pp_<identifier>_<id> → "<identifier>_<id>". */
export const RAZORPAY_PROVIDER_KEY = "razorpay_razorpay"

/**
 * POST /hooks/razorpay
 *
 * 1. Verify X-Razorpay-Signature (HMAC-SHA256 of the raw body) — reject 400.
 * 2. Record X-Razorpay-Event-Id in the webhook ledger (unique index). A
 *    duplicate delivery is acknowledged with 200 and NOT re-dispatched.
 * 3. Hand the event to Medusa's standard payment-webhook pipeline
 *    (delayed, retried, cart-locked processPaymentWorkflow).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  const raw = (req as any).rawBody as Buffer | undefined
  const signature = headerValue(req.headers as Record<string, unknown>, "x-razorpay-signature")

  if (!secret) {
    logger.error("[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET not configured; rejecting")
    return res.status(503).json({ message: "Webhook not configured" })
  }
  if (!raw || !verifyWebhookSignature(raw, signature, secret)) {
    logger.warn("[razorpay-webhook] invalid signature rejected")
    return res.status(400).json({ message: "Invalid signature" })
  }

  const body = req.body as any
  const eventType: string = String(body?.event ?? "unknown")
  const eventId =
    headerValue(req.headers as Record<string, unknown>, "x-razorpay-event-id") ??
    "sha256:" + crypto.createHash("sha256").update(raw).digest("hex")
  const payment = body?.payload?.payment?.entity
  const sessionId =
    notesOf(payment).session_id ?? notesOf(body?.payload?.order?.entity).session_id ?? null

  const sparky = req.scope.resolve<SparkyModuleService>(SPARKY_MODULE)

  let ledgerId: string
  try {
    const created = await sparky.createWebhookEvents({
      provider: "razorpay",
      event_id: eventId,
      event_type: eventType,
      session_id: sessionId,
      provider_reference: payment?.id ?? null,
      status: "received",
    })
    ledgerId = created.id
  } catch (e) {
    const [existing] = await sparky.listWebhookEvents({ provider: "razorpay", event_id: eventId })
    if (existing) {
      await sparky.updateWebhookEvents({
        id: existing.id,
        received_count: (existing.received_count ?? 1) + 1,
      })
      logger.info(`[razorpay-webhook] duplicate delivery ${eventId} (${eventType}) acknowledged`)
      return res.status(200).json({ received: true, duplicate: true })
    }
    logger.error(`[razorpay-webhook] ledger write failed: ${(e as Error).message}`)
    // Let Razorpay retry later.
    return res.status(500).json({ message: "Temporary failure" })
  }

  const handled = ["payment.authorized", "payment.captured", "payment.failed", "order.paid"]
  if (!handled.includes(eventType) || !sessionId) {
    await sparky.updateWebhookEvents({ id: ledgerId, status: "ignored" })
    return res.status(200).json({ received: true, ignored: true })
  }

  try {
    const eventBus = req.scope.resolve(Modules.EVENT_BUS)
    await eventBus.emit(
      {
        name: PaymentWebhookEvents.WebhookReceived,
        data: {
          provider: RAZORPAY_PROVIDER_KEY,
          payload: {
            data: body,
            rawData: raw,
            headers: { "x-razorpay-signature": signature },
          },
        },
      },
      { delay: 5000, attempts: 3 }
    )
    await sparky.updateWebhookEvents({ id: ledgerId, status: "dispatched" })
  } catch (e) {
    await sparky.updateWebhookEvents({ id: ledgerId, status: "failed", error: (e as Error).message })
    // Remove the ledger claim so Razorpay's retry can be processed.
    await sparky.deleteWebhookEvents(ledgerId)
    logger.error(`[razorpay-webhook] dispatch failed: ${(e as Error).message}`)
    return res.status(500).json({ message: "Temporary failure" })
  }
  return res.status(200).json({ received: true })
}
