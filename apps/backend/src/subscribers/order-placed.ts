import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * Sends the order confirmation email. Runs in the worker process.
 * Failures are logged (without PII) and do not affect the order itself.
 */
export default async function orderPlacedHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  let notification: any
  try {
    notification = container.resolve(Modules.NOTIFICATION)
  } catch {
    return
  }

  const { data: orders } = await query.graph({
    entity: "order",
    fields: [
      "id",
      "display_id",
      "email",
      "currency_code",
      "total",
      "subtotal",
      "shipping_total",
      "tax_total",
      "items.*",
      "shipping_address.*",
      "payment_collections.payment_sessions.provider_id",
    ],
    filters: { id: data.id },
  })
  const order = orders[0]
  if (!order?.email) return

  const providerId: string | undefined = (order as any).payment_collections?.[0]?.payment_sessions?.[0]
    ?.provider_id
  const payment_method_label = providerId?.startsWith("pp_cod")
    ? "Cash on Delivery"
    : providerId?.startsWith("pp_razorpay")
      ? "Paid online (Razorpay)"
      : undefined

  try {
    await notification.createNotifications({
      to: order.email,
      channel: "email",
      template: "order-placed",
      data: { order, payment_method_label },
      idempotency_key: `order-placed-${order.id}`,
    })
  } catch (e) {
    logger.error(`[order-placed] confirmation email failed for order ${order.id}: ${(e as Error).message}`)
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
