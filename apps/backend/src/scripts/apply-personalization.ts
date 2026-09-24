/**
 * Applies data/personalization.json to products (by handle). Idempotent:
 * keys already present on the product are left alone unless
 * PERSONALIZATION_FORCE=true, so later Admin edits are preserved.
 */
import fs from "node:fs"
import path from "node:path"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows"

export default async function applyPersonalization({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const productModule = container.resolve(Modules.PRODUCT)
  const file = path.resolve(process.env.PERSONALIZATION_FILE ?? "data/personalization.json")
  const cfg = JSON.parse(fs.readFileSync(file, "utf8")).products as Record<string, Record<string, string>>
  const force = process.env.PERSONALIZATION_FORCE === "true"
  for (const [handle, keys] of Object.entries(cfg)) {
    const [p] = await productModule.listProducts({ handle })
    if (!p) {
      logger.warn(`[personalization] product ${handle} not found (import products first)`)
      continue
    }
    const current = (p.metadata ?? {}) as Record<string, unknown>
    const next = { ...current }
    let changed = 0
    for (const [k, v] of Object.entries(keys)) {
      if (force || current[k] === undefined || current[k] === null || current[k] === "") {
        if (current[k] !== v) {
          next[k] = v
          changed++
        }
      }
    }
    if (changed) {
      await updateProductsWorkflow(container).run({ input: { products: [{ id: p.id, metadata: next } as any] } })
    }
    logger.info(`[personalization] ${handle}: ${changed ? `${changed} key(s) set` : "unchanged"}`)
  }
}
