/**
 * Sends "activate your account on our new store" emails to customers
 * migrated from Shopify. Shopify passwords are never migrated; each migrated
 * customer has a login identity with an unusable random password, and this
 * email carries a single-use, 15-minute password-set link (the standard
 * Medusa reset-token workflow).
 *
 * Run AFTER cutover (links point at STOREFRONT_URL):
 *   ACTIVATION_MODE=dry-run|send ACTIVATION_LIMIT=200 npx medusa exec ./src/scripts/send-customer-activation.ts
 * Idempotent: customers already emailed are skipped unless ACTIVATION_RESEND=true.
 */
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { generateResetPasswordTokenWorkflow } from "@medusajs/medusa/core-flows"
import { SPARKY_MODULE } from "../modules/sparky"
import type SparkyModuleService from "../modules/sparky/service"

export default async function sendCustomerActivation({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
  const sparky = container.resolve<SparkyModuleService>(SPARKY_MODULE)
  const customerModule = container.resolve(Modules.CUSTOMER)
  const mode = process.env.ACTIVATION_MODE === "send" ? "send" : "dry-run"
  const limit = Math.max(Number(process.env.ACTIVATION_LIMIT ?? 200) || 200, 1)
  const resend = process.env.ACTIVATION_RESEND === "true"

  if (mode === "send" && !process.env.STOREFRONT_URL) throw new Error("STOREFRONT_URL must be set so links point at the live store")
  // Medusa always registers a local "feed" provider; only SMTP delivers email.
  if (mode === "send" && !process.env.SMTP_HOST) {
    throw new Error("No email provider configured (SMTP_*); activation emails cannot be sent")
  }

  const mappings = await sparky.listSourceMappings({ source: "shopify", entity_type: "customer" }, { take: 100000 })
  const pending = mappings.filter((m: any) => resend || !m.metadata?.activation_sent_at)
  let sent = 0
  for (const m of pending.slice(0, limit)) {
    const [c] = await customerModule.listCustomers({ id: m.target_id })
    if (!c?.email) continue
    if (mode === "dry-run") {
      sent++
      continue
    }
    await generateResetPasswordTokenWorkflow(container).run({
      input: {
        entityId: c.email,
        actorType: "customer",
        provider: "emailpass",
        secret: config.projectConfig.http.jwtSecret!,
        jwtOptions: config.projectConfig.http.jwtOptions,
        metadata: { variant: "activation" },
      },
    })
    await sparky.updateSourceMappings({ id: m.id, metadata: { ...(m.metadata as object), activation_sent_at: new Date().toISOString() } })
    sent++
  }
  logger.info(`[activation] mode=${mode} migrated=${mappings.length} pending=${pending.length} ${mode === "send" ? "sent" : "would send"}=${sent}`)
}
