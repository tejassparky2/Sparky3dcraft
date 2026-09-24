import { model } from "@medusajs/framework/utils"

/**
 * Maps an external (Shopify) record to the Medusa record created from it.
 * (source, entity_type, source_id) is unique, which is what makes the
 * importer idempotent: a re-run looks up the mapping before creating.
 */
const SourceMapping = model
  .define("sparky_source_mapping", {
    id: model.id({ prefix: "srcmap" }).primaryKey(),
    source: model.text(), // e.g. "shopify"
    entity_type: model.text(), // product | variant | collection | customer | order | image
    source_id: model.text(), // numeric Shopify ID as string (== GID suffix)
    source_handle: model.text().nullable(),
    target_id: model.text(), // Medusa ID
    source_updated_at: model.dateTime().nullable(),
    checksum: model.text().nullable(), // sha256 of the normalized source payload
    metadata: model.json().nullable(),
  })
  .indexes([
    {
      on: ["source", "entity_type", "source_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    { on: ["entity_type", "target_id"] },
  ])

export default SourceMapping
