import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { SPARKY_MODULE } from "../modules/sparky"
import type SparkyModuleService from "../modules/sparky/service"
import { deletePrivate } from "../lib/private-storage"

/**
 * Deletes personalization photos that never became part of an order
 * (abandoned carts) after UPLOAD_RETENTION_DAYS (default 30). Photos attached
 * to orders are kept.
 */
export default async function cleanupUploads(container: MedusaContainer) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const sparky = container.resolve<SparkyModuleService>(SPARKY_MODULE)
  const days = Math.max(Number(process.env.UPLOAD_RETENTION_DAYS ?? 30) || 30, 7)
  const cutoff = new Date(Date.now() - days * 86400_000)
  const stale = await sparky.listCustomerUploads({ status: "pending", created_at: { $lt: cutoff } } as any, { take: 500 })
  let removed = 0
  for (const u of stale) {
    try {
      await deletePrivate({ storage: u.storage as "local" | "s3", key: u.key })
      await sparky.updateCustomerUploads({ id: u.id, status: "deleted" })
      removed++
    } catch (e) {
      logger.warn(`[cleanup-uploads] ${u.id}: ${(e as Error).message}`)
    }
  }
  if (removed) logger.info(`[cleanup-uploads] removed ${removed} abandoned personalization uploads older than ${days} days`)
}

export const config = { name: "sparky-cleanup-uploads", schedule: "17 3 * * *" }
