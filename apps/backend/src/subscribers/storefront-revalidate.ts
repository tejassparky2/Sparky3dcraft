import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * Tells the Next.js storefront to drop its cached catalog when products,
 * variants, categories or inventory change in Medusa Admin, so edits appear
 * without a rebuild. (Price-list-only edits are picked up by the storefront's
 * short cache TTL, CATALOG_REVALIDATE_SECONDS.)
 */
export default async function storefrontRevalidate({ event, container }: SubscriberArgs<unknown>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const url = process.env.STOREFRONT_REVALIDATE_URL
  const secret = process.env.REVALIDATE_SECRET
  if (!url || !secret) return
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-revalidate-secret": secret },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) logger.warn(`[storefront-revalidate] ${event.name}: storefront answered HTTP ${res.status}`)
  } catch (e) {
    logger.warn(`[storefront-revalidate] ${event.name}: ${(e as Error).message}`)
  }
}

export const config: SubscriberConfig = {
  event: [
    "product.created",
    "product.updated",
    "product.deleted",
    "product-variant.created",
    "product-variant.updated",
    "product-variant.deleted",
    "product-category.created",
    "product-category.updated",
    "product-category.deleted",
    "inventory-level.created",
    "inventory-level.updated",
    "inventory-level.deleted",
  ],
  context: { subscriberId: "sparky-storefront-revalidate" },
}
