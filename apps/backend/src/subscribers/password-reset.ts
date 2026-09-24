import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

type ResetEvent = {
  entity_id: string // email
  actor_type: string
  token: string
  metadata?: Record<string, unknown>
}

/**
 * Emails the reset link. The token is never logged.
 * Customer links go to the storefront; admin-user links to the Admin app.
 */
export default async function passwordResetHandler({
  event: { data },
  container,
}: SubscriberArgs<ResetEvent>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  let notification: any
  try {
    notification = container.resolve(Modules.NOTIFICATION)
  } catch {
    logger.warn("[password-reset] notification module unavailable; reset email not sent")
    return
  }
  const storefront = (process.env.STOREFRONT_URL || "").replace(/\/$/, "")
  const backend = (process.env.MEDUSA_BACKEND_URL || "").replace(/\/$/, "")
  const params = new URLSearchParams({ token: data.token, email: data.entity_id })
  const url =
    data.actor_type === "customer"
      ? `${storefront}/reset-password?${params}`
      : `${backend}/app/reset-password?${params}`

  try {
    await notification.createNotifications({
      to: data.entity_id,
      channel: "email",
      template: "password-reset",
      data: { url, variant: data.metadata?.variant === "activation" ? "activation" : "reset" },
    })
  } catch (e) {
    logger.error(`[password-reset] email failed: ${(e as Error).message}`)
  }
}

export const config: SubscriberConfig = {
  event: "auth.password_reset",
}
