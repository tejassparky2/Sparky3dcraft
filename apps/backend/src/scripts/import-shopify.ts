/**
 * Shopify → Medusa import entrypoint.
 *
 *   IMPORT_MODE=dry-run SHOPIFY_SOURCE=public SHOPIFY_STORE_URL=https://sparky3dcraft.tech \
 *     npx medusa exec ./src/scripts/import-shopify.ts
 *
 * Env:
 *   SHOPIFY_SOURCE      public | admin | csv
 *   IMPORT_MODE         probe | dry-run | apply        (default dry-run)
 *   IMPORT_ENTITIES     products,collections[,customers,orders]
 *   IMPORT_FORCE        true → re-apply even when source checksum unchanged
 *   IMPORT_FORCE_IMAGES true → also re-download/re-upload images (old files are orphaned)
 *   SHOPIFY_STORE_URL   (public)  https://sparky3dcraft.tech
 *   SHOPIFY_SHOP_DOMAIN (admin)   xxxx.myshopify.com
 *   SHOPIFY_ADMIN_TOKEN (admin)   shpat_… (never logged)
 *   SHOPIFY_API_VERSION (admin)   default 2026-07
 *   SHOPIFY_CSV_PATH    (csv)     path to products_export.csv
 *   SHOPIFY_SNAPSHOT_DIR          where the raw normalized source snapshot is saved (default ./migration-snapshots)
 */
import fs from "node:fs"
import path from "node:path"
import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ShopifyImporter, type Entity, type ImportMode } from "../lib/shopify/importer"
import { fetchPublicSnapshot } from "../lib/shopify/sources/public-json"
import { fetchAdminSnapshot, probeAdmin } from "../lib/shopify/sources/admin-graphql"
import { readCsvSnapshot } from "../lib/shopify/sources/csv"
import { SPARKY_MODULE } from "../modules/sparky"
import type SparkyModuleService from "../modules/sparky/service"
import type { SourceSnapshot } from "../lib/shopify/types"

export default async function importShopify({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const env = (n: string) => (process.env[n] ?? "").trim()
  const source = env("SHOPIFY_SOURCE") || "public"
  const mode = (env("IMPORT_MODE") || "dry-run") as ImportMode | "probe"
  const entities = (env("IMPORT_ENTITIES") || "products,collections")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as Entity[]

  if (!["probe", "dry-run", "apply"].includes(mode)) throw new Error(`IMPORT_MODE must be probe|dry-run|apply`)
  if (env("SPARKY_CUTOVER_COMPLETED") === "true" && mode === "apply" && env("IMPORT_ALLOW_AFTER_CUTOVER") !== "true") {
    throw new Error(
      "Cutover is complete: Medusa is now the source of truth and a Shopify re-import would overwrite merchant edits. Set IMPORT_ALLOW_AFTER_CUTOVER=true only if you really mean it."
    )
  }
  if ((entities.includes("customers") || entities.includes("orders")) && source !== "admin") {
    throw new Error("customers/orders can only be imported from the Shopify Admin API source (SHOPIFY_SOURCE=admin)")
  }

  // Rule: do not silently mix ID-based and handle-based sources.
  const sparky = container.resolve<SparkyModuleService>(SPARKY_MODULE)
  const prior = await sparky.listMigrationRuns({ status: "completed" }, { take: 50, order: { created_at: "DESC" } } as any)
  const kind = source === "csv" ? "shopify-csv" : source === "admin" ? "shopify-admin" : "shopify-public"
  const idBased = (k: string) => k === "shopify-admin" || k === "shopify-public"
  const conflicting = prior.find((r: any) => idBased(r.source) !== idBased(kind))
  if (conflicting && mode === "apply" && env("IMPORT_ALLOW_SOURCE_SWITCH") !== "true") {
    throw new Error(
      `A previous import used ${conflicting.source}; switching to ${kind} changes the identity strategy (Shopify IDs vs handles). ` +
        `Products are still matched by unique handle so duplicates cannot be created, but review docs/MIGRATION.md and set IMPORT_ALLOW_SOURCE_SWITCH=true to proceed.`
    )
  }

  let snapshot: SourceSnapshot
  if (source === "public") {
    const url = env("SHOPIFY_STORE_URL")
    if (!url) throw new Error("SHOPIFY_STORE_URL is required for SHOPIFY_SOURCE=public")
    if (mode === "probe") {
      logger.info("[shopify-import] probe is only meaningful for the admin source")
      return
    }
    snapshot = await fetchPublicSnapshot({ storeUrl: url })
  } else if (source === "admin") {
    const shopDomain = env("SHOPIFY_SHOP_DOMAIN")
    const accessToken = env("SHOPIFY_ADMIN_TOKEN")
    if (!shopDomain || !accessToken) throw new Error("SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_TOKEN are required for SHOPIFY_SOURCE=admin")
    const opts = { shopDomain, accessToken, apiVersion: env("SHOPIFY_API_VERSION") || "2026-07" }
    if (mode === "probe") {
      for (const line of await probeAdmin(opts, entities)) logger.info(`[shopify-import] probe: ${line}`)
      return
    }
    snapshot = await fetchAdminSnapshot(opts, entities)
  } else if (source === "csv") {
    const p = env("SHOPIFY_CSV_PATH")
    if (!p) throw new Error("SHOPIFY_CSV_PATH is required for SHOPIFY_SOURCE=csv")
    if (entities.includes("collections")) logger.warn("[shopify-import] CSV exports contain no collections; skipping collections")
    snapshot = readCsvSnapshot(p)
  } else {
    throw new Error(`Unknown SHOPIFY_SOURCE ${source}`)
  }

  // Source backup before any write (normalized, no credentials).
  const dir = path.resolve(env("SHOPIFY_SNAPSHOT_DIR") || "migration-snapshots")
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const stamp = snapshot.fetched_at.replace(/[:.]/g, "-")
  const snapFile = path.join(dir, `${kind}-${stamp}.json`)
  fs.writeFileSync(snapFile, JSON.stringify(snapshot, null, 2), { mode: 0o600 })
  logger.info(`[shopify-import] source snapshot saved: ${snapFile}`)
  logger.info(
    `[shopify-import] source=${kind} products=${snapshot.products.length} collections=${snapshot.collections.length}` +
      (snapshot.customers ? ` customers=${snapshot.customers.length}` : "") +
      (snapshot.orders ? ` orders=${snapshot.orders.length}` : "")
  )

  const report = await new ShopifyImporter(container, snapshot, { mode: mode as ImportMode, entities, force: env("IMPORT_FORCE") === "true", forceImages: env("IMPORT_FORCE_IMAGES") === "true" }).run()
  const reportFile = path.join(dir, `report-${mode}-${stamp}.json`)
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 })

  const c = (n: string, x: any) => `${n}: created=${x.created} updated=${x.updated} adopted=${x.adopted} unchanged=${x.unchanged} skipped=${x.skipped} failed=${x.failed}`
  logger.info(`[shopify-import] ${c("products", report.products)}`)
  logger.info(`[shopify-import] images: uploaded=${report.images.uploaded} reused=${report.images.reused} failed=${report.images.failed}`)
  logger.info(`[shopify-import] sale prices: set=${report.sale_prices.set} removed=${report.sale_prices.removed}`)
  logger.info(`[shopify-import] inventory: levels_created=${report.inventory.levels_created} levels_updated=${report.inventory.levels_updated} unmanaged_unknown=${report.inventory.unmanaged_unknown}`)
  logger.info(`[shopify-import] ${c("categories", report.categories)}`)
  if (entities.includes("customers")) logger.info(`[shopify-import] ${c("customers", report.customers)}`)
  if (entities.includes("orders")) logger.info(`[shopify-import] ${c("orders", report.orders)}`)
  for (const w of report.warnings) logger.warn(`[shopify-import] WARN ${w}`)
  for (const e of report.errors) logger.error(`[shopify-import] ERROR ${e}`)
  logger.info(`[shopify-import] report: ${reportFile}`)
  if (report.errors.length) {
    process.exitCode = 1
  }
}
