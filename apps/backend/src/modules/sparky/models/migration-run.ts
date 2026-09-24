import { model } from "@medusajs/framework/utils"

/** One row per importer execution, for auditability and resumability. */
const MigrationRun = model.define("sparky_migration_run", {
  id: model.id({ prefix: "migrun" }).primaryKey(),
  source: model.text(), // shopify-admin | shopify-public | shopify-csv
  mode: model.text(), // dry-run | apply
  status: model.enum(["running", "completed", "failed"]).default("running"),
  stats: model.json().nullable(),
  error: model.text().nullable(),
  finished_at: model.dateTime().nullable(),
})

export default MigrationRun
