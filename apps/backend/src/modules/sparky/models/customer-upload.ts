import { model } from "@medusajs/framework/utils"

/** A file a customer uploaded for product personalization (private). */
const CustomerUpload = model.define("sparky_customer_upload", {
  id: model.id({ prefix: "cupl" }).primaryKey(),
  storage: model.enum(["local", "s3"]),
  key: model.text(),
  filename: model.text(),
  mime: model.text(),
  size: model.number(),
  sha256: model.text(),
  status: model.enum(["pending", "attached", "deleted"]).default("pending"),
  cart_id: model.text().nullable(),
  order_id: model.text().nullable(),
})

export default CustomerUpload
